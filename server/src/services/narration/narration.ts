import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  NARRATION_MODEL,
  narrationTextFor,
  slotKey,
  splitIntoUtterances,
  type NarrationReady,
  type NarrationSlot,
  type NarrationVoiceId,
} from '@storybook/shared';
import prisma from '../../db/prisma';
import { getStorage } from '../storage';
import { checkQuota, recordUsage, type QuotaDecision } from '../spend';
import { getNarrationSynthesizer } from './synthesizer';
import { wavDurationMs } from './falKokoro';

/**
 * Cache-or-generate narration (generated-narration spec, design questions 2 and 4).
 *
 * One `NarrationClip` row per (book, slot, voice, model, sha256(text)). The text
 * is always derived here via `narrationTextFor` — callers never supply it — and
 * split with the same `splitIntoUtterances` the client highlights with, so
 * segment `i` is chunk `i` on both sides.
 *
 * Money rules, in order of importance:
 *  - A cache hit never calls the synthesizer, never checks quota, never records.
 *  - A miss checks quota with the page's real `chars` BEFORE any synth call.
 *  - `recordUsage` runs only after every segment is stored AND the row exists,
 *    with the same `chars` the check used. Any synth/put failure records nothing.
 *  - Concurrent first-Plays share one in-flight promise (Render runs one
 *    instance); the unique key is the backstop for anything that slips past it.
 *    Only the originator records usage.
 */

/** Structural, so a Prisma book-with-pages or a test literal both fit. */
export interface NarrationBook {
  id: string;
  title: string;
  author: string;
  pages: { page_number: number; text: string }[];
}

export type GenerateOutcome =
  | { kind: 'ready'; clip: NarrationReady } // cached:true → no charge happened
  | { kind: 'no-such-slot' }
  | { kind: 'quota'; decision: QuotaDecision }
  | { kind: 'upstream-failed' };

/** Max synth calls in flight for one page (spec design question 1). */
export const NARRATION_SYNTH_CONCURRENCY = 4;

// Stored form of a segment: the storage key, not the URL. The URL is a serving
// concern (`/illustrations/<key>`) and is derived on read.
const StoredSegmentsSchema = z
  .array(
    z.object({
      index: z.number().int().nonnegative(),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      key: z.string(),
      durationMs: z.number().int().nonnegative(),
    }),
  )
  .min(1);
type StoredSegment = z.infer<typeof StoredSegmentsSchema>[number];

const inFlight = new Map<string, Promise<GenerateOutcome>>();

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** `<bookId>/narration/<slot>-<voiceId>-<hash16>-<i>.wav`. Deterministic, so a retry overwrites. */
export function narrationSegmentKey(
  bookId: string,
  slot: NarrationSlot,
  voiceId: NarrationVoiceId,
  textHash: string,
  index: number,
): string {
  return `${bookId}/narration/${slotKey(slot)}-${voiceId}-${textHash.slice(0, 16)}-${index}.wav`;
}

function toReady(
  slot: NarrationSlot,
  voiceId: NarrationVoiceId,
  textHash: string,
  segments: StoredSegment[],
  cached: boolean,
): NarrationReady {
  return {
    status: 'ready',
    voiceId,
    slot,
    textHash,
    cached,
    segments: segments.map((s) => ({
      index: s.index,
      start: s.start,
      end: s.end,
      url: `/illustrations/${s.key}`,
      durationMs: s.durationMs,
    })),
  };
}

async function lookup(
  bookId: string,
  slot: NarrationSlot,
  voiceId: NarrationVoiceId,
  textHash: string,
): Promise<NarrationReady | null> {
  const row = await prisma.narrationClip.findUnique({
    where: {
      book_id_slot_voice_id_model_text_hash: {
        book_id: bookId,
        slot: slotKey(slot),
        voice_id: voiceId,
        model: NARRATION_MODEL,
        text_hash: textHash,
      },
    },
  });
  if (!row) return null;
  // A row that fails to parse is a bug, not a cache miss: treating it as a miss
  // would re-synthesise, hit the unique key, re-read the same row, and loop.
  const segments = StoredSegmentsSchema.parse(JSON.parse(row.segments_json));
  return toReady(slot, voiceId, textHash, segments, true);
}

/** Free lookup. Never calls the synthesizer. Null for a missing slot or an uncached page. */
export async function findNarration(
  book: NarrationBook,
  slot: NarrationSlot,
  voiceId: NarrationVoiceId,
): Promise<NarrationReady | null> {
  const text = narrationTextFor(book, slot);
  if (text === null) return null;
  return lookup(book.id, slot, voiceId, sha256Hex(text));
}

/** Lookup → (miss) checkQuota(chars) → split → synth ≤4 parallel → put each → create row → recordUsage(chars). */
export async function generateNarration(
  book: NarrationBook,
  slot: NarrationSlot,
  voiceId: NarrationVoiceId,
  requester: { id: string; isAdmin: boolean },
): Promise<GenerateOutcome> {
  const text = narrationTextFor(book, slot);
  if (text === null) return { kind: 'no-such-slot' };
  const textHash = sha256Hex(text);
  const cacheKey = [book.id, slotKey(slot), voiceId, NARRATION_MODEL, textHash].join('\u0000');

  // Join a generation already running for this exact clip instead of buying it twice.
  for (;;) {
    const pending = inFlight.get(cacheKey);
    if (!pending) break;
    const shared = await pending;
    // We did not pay for it, so from our side it is a cache hit.
    if (shared.kind === 'ready') return { kind: 'ready', clip: { ...shared.clip, cached: true } };
    // Quota is the originator's ceiling, not ours — fall through and try on our own.
    if (shared.kind === 'quota') continue;
    return shared;
  }

  const run = runGeneration(book.id, slot, voiceId, text, textHash, requester);
  inFlight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(cacheKey) === run) inFlight.delete(cacheKey);
  }
}

function toLogSafe(value: unknown): string {
  return String(value).replace(/[\u0000-\u001F\u007F]/g, '');
}

async function runGeneration(
  bookId: string,
  slot: NarrationSlot,
  voiceId: NarrationVoiceId,
  text: string,
  textHash: string,
  requester: { id: string; isAdmin: boolean },
): Promise<GenerateOutcome> {
  const hit = await lookup(bookId, slot, voiceId, textHash);
  if (hit) return { kind: 'ready', clip: hit };

  const chunks = splitIntoUtterances(text);
  // Whitespace-only page text: nothing to speak, and a ready response needs >= 1
  // segment. Decided before the quota check so it costs nothing.
  if (chunks.length === 0) return { kind: 'no-such-slot' };

  const chars = text.length;
  const decision = await checkQuota(requester.id, 'narration', requester.isAdmin, undefined, undefined, chars);
  if (!decision.allowed) return { kind: 'quota', decision };

  const synthesizer = getNarrationSynthesizer();
  const storage = getStorage();
  const segments: StoredSegment[] = new Array(chunks.length);
  let failed = false;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (!failed && next < chunks.length) {
      const index = next++;
      const chunk = chunks[index]!;
      try {
        const bytes = await synthesizer.synthesize(chunk.text, voiceId);
        const durationMs = wavDurationMs(bytes);
        if (failed) return; // a sibling already failed; don't store more of a dead page
        const key = narrationSegmentKey(bookId, slot, voiceId, textHash, index);
        await storage.put(key, bytes, 'audio/wav');
        segments[index] = { index, start: chunk.start, end: chunk.end, key, durationMs };
      } catch (err) {
        failed = true;
        // Never log the text (user content) or vendor detail beyond the message.
        const safeSlotKey = toLogSafe(slotKey(slot));
        const safeVoiceId = toLogSafe(voiceId);
        const safeErrorMessage = toLogSafe(err instanceof Error ? err.message : err);
        console.error(
          'Narration synthesis failed for %s/%s/%s segment %s: %s',
          bookId,
          safeSlotKey,
          safeVoiceId,
          String(index),
          safeErrorMessage,
        );
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(NARRATION_SYNTH_CONCURRENCY, chunks.length) }, () => worker()),
  );
  // Partially uploaded keys are left in place: they are deterministic and the
  // retry overwrites them. No row, no UsageLog.
  if (failed) return { kind: 'upstream-failed' };

  try {
    await prisma.narrationClip.create({
      data: {
        book_id: bookId,
        slot: slotKey(slot),
        voice_id: voiceId,
        model: NARRATION_MODEL,
        text_hash: textHash,
        chars,
        segments_json: JSON.stringify(segments),
        created_by: requester.id,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Someone else's row landed first (only possible across processes, or a
      // race the in-flight map missed). Theirs is the canonical clip; we bill nothing.
      const winner = await lookup(bookId, slot, voiceId, textHash);
      if (winner) return { kind: 'ready', clip: winner };
    }
    throw err;
  }

  await recordUsage(requester.id, 'narration', undefined, chars);
  return { kind: 'ready', clip: toReady(slot, voiceId, textHash, segments, false) };
}
