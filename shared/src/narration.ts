import { z } from 'zod';

// ---------------------------------------------------------------------------
// Narration — read-aloud contract (spec: .code-captain/specs/generated-narration/)
//
// Segmentation used to be client-internal (ADR-011 decision 6). Generated voices make
// it cross the network: the server synthesises one clip per chunk and returns offsets
// in the same coordinate space the client highlights in, so both sides must split by
// the same function. That is why `splitIntoUtterances` and `narrationTextFor` live here.
// ---------------------------------------------------------------------------

/**
 * A speakable unit plus its `[start, end)` offsets into the original page text.
 *
 * The offsets are what let the renderer highlight a sentence without re-deriving
 * anything — `page.text.slice(start, end)` is exactly the region to wrap in a span.
 */
export interface NarrationChunk {
  text: string;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Segmentation (moved verbatim from client/src/lib/narration/chunk.ts)
// ---------------------------------------------------------------------------

/**
 * Chrome silently truncates a single utterance past ~15s / ~200-250 chars and can wedge
 * the whole synthesis queue doing it (chromium#41346274). This is a correctness limit,
 * not a tuning knob — raising it trades a highlight nicety for silent truncation.
 */
export const MAX_CHUNK_CHARS = 200

/** Sentence terminators, including the single-character ellipsis. */
const TERMINATORS = new Set(['.', '!', '?', '…'])

/**
 * Characters allowed between a terminator and the whitespace that ends a sentence.
 * Children's-book dialogue is full of `!"` / `?'` / `."`, and splitting *before* the
 * closing quote would strand it at the head of the next chunk.
 */
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»'])

/**
 * Deliberately tiny and literal. Sentence segmentation is an NLP problem; this is a
 * storefront. These five cover essentially every abbreviation that shows up in a
 * children's story, and anything past them is not worth the maintenance.
 */
const ABBREVIATIONS = new Set(['Mr', 'Mrs', 'Ms', 'Dr', 'St'])

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch)
}

/** True when the word immediately before `dotIndex` is one of the known abbreviations. */
function endsWithAbbreviation(text: string, dotIndex: number): boolean {
  let start = dotIndex
  while (start > 0 && /[A-Za-z]/.test(text[start - 1] as string)) start--
  return ABBREVIATIONS.has(text.slice(start, dotIndex))
}

/**
 * Splits `text` into contiguous sentence spans. Trailing whitespace is folded into the
 * span it follows, so the spans tile the entire string with no gaps — that is what makes
 * the round-trip invariant (`chunks.map(c => text.slice(c.start, c.end)).join('')`)
 * hold, and it is why a highlight visually includes its own punctuation and trailing
 * space rather than flickering between words.
 */
function sentenceSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  let start = 0
  let i = 0

  while (i < text.length) {
    const ch = text[i] as string
    if (!TERMINATORS.has(ch)) {
      i++
      continue
    }
    if (ch === '.' && endsWithAbbreviation(text, i)) {
      i++
      continue
    }

    let j = i + 1
    while (j < text.length && CLOSERS.has(text[j] as string)) j++

    // A terminator only ends a sentence when whitespace (or the end of the text)
    // follows. This is also what keeps `3.5` and `Wait...` from splitting mid-token.
    if (j < text.length && !isWhitespace(text[j])) {
      i++
      continue
    }

    while (j < text.length && isWhitespace(text[j])) j++
    spans.push([start, j])
    start = j
    i = j
  }

  if (start < text.length) spans.push([start, text.length])
  return spans
}

/**
 * Splits page text into speakable chunks with offsets back into the original string.
 *
 * Rules, in order:
 * 1. Split on sentence terminators (`.` `!` `?` `…`) plus any trailing closing
 *    quote/bracket and the whitespace that follows.
 * 2. Never split on a terminator that belongs to a known short abbreviation.
 * 3. Hard-split anything still longer than `maxChars` at the last word boundary before
 *    the limit; a single over-long word is split mid-word rather than emitted over-length.
 * 4. `text` is trimmed, but `start`/`end` keep pointing at the untrimmed span.
 * 5. Empty or whitespace-only input returns `[]`, and no zero-length chunk is ever emitted.
 */
export function splitIntoUtterances(text: string, maxChars: number = MAX_CHUNK_CHARS): NarrationChunk[] {
  if (text.trim().length === 0) return []

  const limit = Math.max(1, Math.floor(maxChars))
  const chunks: NarrationChunk[] = []
  // Holds leading whitespace that precedes the first real chunk, so coverage stays
  // contiguous from index 0 without emitting a whitespace-only chunk.
  let pendingStart: number | null = null

  const emit = (spanStart: number, spanEnd: number): void => {
    if (spanEnd <= spanStart) return
    const from = pendingStart ?? spanStart
    const body = text.slice(from, spanEnd)

    if (body.trim().length === 0) {
      // Whitespace-only region: fold it into the previous chunk rather than dropping it
      // (which would break the round-trip) or emitting an empty one.
      const last = chunks[chunks.length - 1]
      if (last) {
        last.end = spanEnd
        pendingStart = null
      } else {
        pendingStart = from
      }
      return
    }

    pendingStart = null
    chunks.push({ text: body.trim(), start: from, end: spanEnd })
  }

  for (const [spanStart, spanEnd] of sentenceSpans(text)) {
    let cursor = spanStart

    while (spanEnd - cursor > limit) {
      const hardLimit = cursor + limit
      let breakAt = -1
      for (let i = hardLimit; i > cursor; i--) {
        if (isWhitespace(text[i])) {
          breakAt = i
          break
        }
      }

      if (breakAt === -1) {
        // A single word longer than the limit. Splitting mid-word is ugly; an
        // over-length utterance is silently truncated by the engine, which is worse.
        emit(cursor, hardLimit)
        cursor = hardLimit
        continue
      }

      let runEnd = breakAt
      while (runEnd < spanEnd && isWhitespace(text[runEnd])) runEnd++
      emit(cursor, runEnd)
      cursor = runEnd
    }

    emit(cursor, spanEnd)
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Slots — which piece of a book is being read
// ---------------------------------------------------------------------------

/** `'cover'`, `'end'`, or a `Page.page_number` (>= 1). */
export type NarrationSlot = 'cover' | 'end' | number;

export const NarrationSlotSchema = z.union([
  z.literal('cover'),
  z.literal('end'),
  z.number().int().min(1),
]);

/** The minimum a book needs to be narrated. Structural, so client and server books both fit. */
export interface NarratableBook {
  title: string;
  author: string;
  pages: { page_number: number; text: string }[];
}

/**
 * The exact text read for a slot. Single source for the client's on-screen chunks and
 * the server's synthesis input, so generated offsets line up with the highlight.
 * Returns null for a page number the book does not have.
 */
export function narrationTextFor(book: NarratableBook, slot: NarrationSlot): string | null {
  if (slot === 'cover') return `${book.title}. By ${book.author}.`;
  if (slot === 'end') return 'The End.';
  const page = book.pages.find((p) => p.page_number === slot);
  return page ? page.text : null;
}

/** Storage/DB form of a slot: `'cover'`, `'end'`, or `p<N>`. */
export function slotKey(slot: NarrationSlot): string {
  return typeof slot === 'number' ? `p${slot}` : slot;
}

/**
 * Reading order: cover → pages ascending → end → null. `pageNumbers` need not be sorted.
 * A page slot not in `pageNumbers` returns null rather than guessing a neighbour.
 */
export function nextSlot(slot: NarrationSlot, pageNumbers: number[]): NarrationSlot | null {
  const ordered = [...pageNumbers].sort((a, b) => a - b);
  if (slot === 'end') return null;
  if (slot === 'cover') return ordered[0] ?? 'end';
  const i = ordered.indexOf(slot);
  if (i === -1) return null;
  return ordered[i + 1] ?? 'end';
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

export const NARRATION_MODEL = 'fal-ai/kokoro/american-english' as const;

/** Prefix that marks a voice preference as a generated voice, e.g. `generated:af_heart`. */
export const GENERATED_VOICE_PREFIX = 'generated:';

export const NARRATION_VOICES = [
  { id: 'af_heart', label: 'Heart', description: 'Warm storyteller', gender: 'female' },
  { id: 'am_michael', label: 'Michael', description: 'Calm and steady', gender: 'male' },
] as const;

export const NarrationVoiceIdSchema = z.enum(['af_heart', 'am_michael']);
export type NarrationVoiceId = z.infer<typeof NarrationVoiceIdSchema>;

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

// GET /api/narration/voices — public, no user data.
export const NarrationVoicesResponseSchema = z.object({
  available: z.boolean(),
  voices: z.array(
    z.object({
      id: NarrationVoiceIdSchema,
      label: z.string(),
      description: z.string(),
      gender: z.enum(['female', 'male']),
    }),
  ),
});
export type NarrationVoicesResponse = z.infer<typeof NarrationVoicesResponseSchema>;

export const NarrationSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  // Offsets into narrationTextFor(...) — the same space as the client's chunks.
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  // '/illustrations/<bookId>/narration/<file>.wav' — relative, like illustration_url.
  url: z.string(),
  durationMs: z.number().int().nonnegative(),
});
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;

export const NarrationReadySchema = z.object({
  status: z.literal('ready'),
  voiceId: NarrationVoiceIdSchema,
  slot: NarrationSlotSchema,
  textHash: z.string(),
  // Meaningful on POST only; GET is always true.
  cached: z.boolean(),
  segments: z.array(NarrationSegmentSchema).min(1),
});
export type NarrationReady = z.infer<typeof NarrationReadySchema>;

export const NarrationMissingSchema = z.object({ status: z.literal('missing') });

// GET /api/books/:id/narration — free, never touches fal.
export const NarrationGetResponseSchema = z.discriminatedUnion('status', [
  NarrationReadySchema,
  NarrationMissingSchema,
]);
export type NarrationGetResponse = z.infer<typeof NarrationGetResponseSchema>;

// POST /api/books/:id/narration — strict: the server derives the text, never the client.
export const NarrationGenerateRequestSchema = z
  .object({ voiceId: NarrationVoiceIdSchema, slot: NarrationSlotSchema })
  .strict();
export type NarrationGenerateRequest = z.infer<typeof NarrationGenerateRequestSchema>;

export const NarrationGenerateResponseSchema = NarrationReadySchema;
export type NarrationGenerateResponse = z.infer<typeof NarrationGenerateResponseSchema>;
