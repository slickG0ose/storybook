import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { narrationTextFor, splitIntoUtterances } from '@storybook/shared';
import prisma from '../../../db/prisma';
import { resetDatabase } from '../../../__tests__/setup';
import { costCentsFor } from '../../spend';
import { getStorage, ILLUSTRATIONS_DIR } from '../../storage';
import { listIllustrationVersions } from '../../illustrations';
import { earliestArtAt } from '../../imagePin';
import { findNarration, generateNarration, type NarrationBook } from '../narration';

// No live fal call: the synthesizer seam is replaced by a call-counting fake that
// returns the committed 100 ms silent WAV. Green here proves cache/meter/storage
// wiring, not that Kokoro speaks correctly.

const fake = vi.hoisted(() => ({
  calls: [] as { text: string; voiceId: string }[],
  failOn: null as string | null,
  /** When set, each synth call waits on this before returning. */
  gate: null as Promise<void> | null,
  wav: null as Buffer | null,
}));

vi.mock('../synthesizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../synthesizer')>();
  return {
    ...actual,
    getNarrationSynthesizer: () => ({
      async synthesize(text: string, voiceId: string): Promise<Buffer> {
        fake.calls.push({ text, voiceId });
        if (fake.gate) await fake.gate;
        if (fake.failOn !== null && text.includes(fake.failOn)) {
          throw new actual.NarrationSynthesisError('fake upstream failure');
        }
        return fake.wav!;
      },
    }),
  };
});

const BOOK_ID = 'narration-service-test';
const BOOK_DIR = join(ILLUSTRATIONS_DIR, BOOK_ID);
const USER = { id: 'user-reader-1', isAdmin: false };

// Three sentences on page 1, so the fake sees three calls.
const PAGE_1 = 'Luna looked up. The stars were singing! Would they sing for her?';

function book(page1: string = PAGE_1): NarrationBook {
  return {
    id: BOOK_ID,
    title: 'Luna and the Star Garden',
    author: 'AI Storybook',
    pages: [
      { page_number: 1, text: page1 },
      { page_number: 2, text: 'She waved goodnight.' },
    ],
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function usageRows() {
  return prisma.usageLog.findMany({ where: { kind: 'narration' } });
}

describe('narration service (cache-or-generate)', () => {
  const savedDaily = process.env.QUOTA_DAILY_PER_USER_CENTS;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.book.create({
      data: {
        id: BOOK_ID,
        title: 'Luna and the Star Garden',
        author: 'AI Storybook',
        description: 'test',
        theme: 'fantasy',
        age_range: '4-7',
        cover_emoji: '*',
        cover_color: '#000000',
        price: 1,
      },
    });
    await rm(BOOK_DIR, { recursive: true, force: true });
    fake.calls = [];
    fake.failOn = null;
    fake.gate = null;
    fake.wav = readFileSync(join(import.meta.dirname, 'fixtures', 'silence-100ms.wav'));
  });

  afterEach(async () => {
    await rm(BOOK_DIR, { recursive: true, force: true });
    if (savedDaily === undefined) delete process.env.QUOTA_DAILY_PER_USER_CENTS;
    else process.env.QUOTA_DAILY_PER_USER_CENTS = savedDaily;
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('miss: one synth call and one stored object per chunk, one row, one UsageLog at the char price', async () => {
    const chunks = splitIntoUtterances(PAGE_1);
    expect(chunks).toHaveLength(3);

    const out = await generateNarration(book(), 1, 'af_heart', USER);

    expect(out.kind).toBe('ready');
    if (out.kind !== 'ready') return;
    expect(out.clip).toMatchObject({ status: 'ready', voiceId: 'af_heart', slot: 1, textHash: sha256(PAGE_1), cached: false });
    expect(fake.calls).toHaveLength(chunks.length);
    expect(fake.calls.map((c) => c.text).sort()).toEqual(chunks.map((c) => c.text).sort());
    expect(fake.calls.every((c) => c.voiceId === 'af_heart')).toBe(true);

    const objects = await getStorage().list(`${BOOK_ID}/narration/`);
    expect(objects).toHaveLength(chunks.length);
    const hash16 = sha256(PAGE_1).slice(0, 16);
    expect(out.clip.segments.map((s) => s.url)).toEqual(
      chunks.map((_, i) => `/illustrations/${BOOK_ID}/narration/p1-af_heart-${hash16}-${i}.wav`),
    );
    expect(out.clip.segments.every((s) => s.durationMs === 100)).toBe(true);

    const rows = await prisma.narrationClip.findMany({ where: { book_id: BOOK_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slot: 'p1', voice_id: 'af_heart', chars: PAGE_1.length, created_by: USER.id });

    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      user_id: USER.id,
      cost_cents: costCentsFor('narration', undefined, PAGE_1.length),
    });
  });

  it('segment start/end equal the shared splitIntoUtterances offsets', async () => {
    const out = await generateNarration(book(), 1, 'af_heart', USER);
    if (out.kind !== 'ready') throw new Error(`expected ready, got ${out.kind}`);
    expect(out.clip.segments.map(({ index, start, end }) => ({ index, start, end }))).toEqual(
      splitIntoUtterances(PAGE_1).map((c, index) => ({ index, start: c.start, end: c.end })),
    );
  });

  it('second call is a cache hit: cached:true, zero synth calls, zero new UsageLog', async () => {
    await generateNarration(book(), 1, 'af_heart', USER);
    fake.calls = [];

    const again = await generateNarration(book(), 1, 'af_heart', { id: 'someone-else', isAdmin: false });

    expect(again).toMatchObject({ kind: 'ready', clip: { cached: true } });
    expect(fake.calls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(1);
  });

  it('findNarration is free: null on a miss, the clip on a hit, and never calls the synthesizer', async () => {
    expect(await findNarration(book(), 1, 'af_heart')).toBeNull();
    const gen = await generateNarration(book(), 1, 'af_heart', USER);
    fake.calls = [];

    const found = await findNarration(book(), 1, 'af_heart');

    expect(found).toEqual(gen.kind === 'ready' ? { ...gen.clip, cached: true } : null);
    expect(await findNarration(book(), 1, 'am_michael')).toBeNull();
    expect(await findNarration(book(), 99, 'af_heart')).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it('an edited page regenerates under a new hash; restoring the old text is a free cache hit', async () => {
    const edited = 'Luna looked down. The flowers were humming.';
    await generateNarration(book(), 1, 'af_heart', USER);

    fake.calls = [];
    const afterEdit = await generateNarration(book(edited), 1, 'af_heart', USER);
    expect(afterEdit).toMatchObject({ kind: 'ready', clip: { cached: false, textHash: sha256(edited) } });
    expect(fake.calls).toHaveLength(splitIntoUtterances(edited).length);
    expect(await usageRows()).toHaveLength(2);

    fake.calls = [];
    const restored = await generateNarration(book(PAGE_1), 1, 'af_heart', USER);
    expect(restored).toMatchObject({ kind: 'ready', clip: { cached: true, textHash: sha256(PAGE_1) } });
    expect(fake.calls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(2);
  });

  it('quota denied: no synth call, no row, no UsageLog', async () => {
    process.env.QUOTA_DAILY_PER_USER_CENTS = '0';

    const out = await generateNarration(book(), 1, 'af_heart', USER);

    expect(out).toMatchObject({ kind: 'quota', decision: { allowed: false, reason: 'daily' } });
    if (out.kind === 'quota') {
      expect(out.decision.costCents).toBe(costCentsFor('narration', undefined, PAGE_1.length));
    }
    expect(fake.calls).toHaveLength(0);
    expect(await prisma.narrationClip.count()).toBe(0);
    expect(await usageRows()).toHaveLength(0);
  });

  it('one segment throws: upstream-failed, no row, no UsageLog', async () => {
    fake.failOn = 'stars were singing';

    const out = await generateNarration(book(), 1, 'af_heart', USER);

    expect(out).toEqual({ kind: 'upstream-failed' });
    expect(await prisma.narrationClip.count()).toBe(0);
    expect(await usageRows()).toHaveLength(0);

    // A retry after the upstream recovers succeeds and bills exactly once.
    fake.failOn = null;
    const retry = await generateNarration(book(), 1, 'af_heart', USER);
    expect(retry).toMatchObject({ kind: 'ready', clip: { cached: false } });
    expect(await usageRows()).toHaveLength(1);
  });

  it('two concurrent calls share one generation: one set of synth calls, one UsageLog', async () => {
    let release!: () => void;
    fake.gate = new Promise<void>((r) => { release = r; });

    const a = generateNarration(book(), 1, 'af_heart', USER);
    const b = generateNarration(book(), 1, 'af_heart', { id: 'user-reader-2', isAdmin: false });
    // Let both reach the synthesizer/in-flight join before releasing.
    await vi.waitFor(() => expect(fake.calls.length).toBeGreaterThan(0));
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(fake.calls).toHaveLength(splitIntoUtterances(PAGE_1).length);
    expect(ra).toMatchObject({ kind: 'ready', clip: { cached: false } });
    expect(rb).toMatchObject({ kind: 'ready', clip: { cached: true } });
    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.user_id).toBe(USER.id);
    expect(await prisma.narrationClip.count()).toBe(1);
  });

  it("'cover' and 'end' speak narrationTextFor output", async () => {
    const b = book();
    const cover = await generateNarration(b, 'cover', 'am_michael', USER);
    const coverText = narrationTextFor(b, 'cover')!;
    expect(cover).toMatchObject({ kind: 'ready', clip: { slot: 'cover', textHash: sha256(coverText) } });
    expect(fake.calls.map((c) => c.text).join(' ')).toBe(
      splitIntoUtterances(coverText).map((c) => c.text).join(' '),
    );

    fake.calls = [];
    const end = await generateNarration(b, 'end', 'am_michael', USER);
    expect(end).toMatchObject({ kind: 'ready', clip: { slot: 'end', textHash: sha256('The End.') } });
    expect(fake.calls.map((c) => c.text)).toEqual(['The End.']);

    const keys = (await getStorage().list(`${BOOK_ID}/narration/`)).map((o) => o.key);
    expect(keys.some((k) => k.startsWith(`${BOOK_ID}/narration/cover-am_michael-`))).toBe(true);
    expect(keys.some((k) => k.startsWith(`${BOOK_ID}/narration/end-am_michael-`))).toBe(true);
  });

  it('a missing page is no-such-slot and costs nothing', async () => {
    const out = await generateNarration(book(), 99, 'af_heart', USER);

    expect(out).toEqual({ kind: 'no-such-slot' });
    expect(fake.calls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  it('a whitespace-only page is no-such-slot and costs nothing', async () => {
    const out = await generateNarration(book('   '), 1, 'af_heart', USER);

    expect(out).toEqual({ kind: 'no-such-slot' });
    expect(fake.calls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  describe('narration/ objects do not leak into illustration scans', () => {
    it('listBookFiles (via listIllustrationVersions fallback) ignores narration/ keys', async () => {
      await mkdir(BOOK_DIR, { recursive: true });
      await writeFile(join(BOOK_DIR, 'page-1.png'), Buffer.from('png'));
      await generateNarration(book(), 1, 'af_heart', USER);

      const versions = await listIllustrationVersions(BOOK_ID, 1);
      expect(versions.map((v) => v.url)).toEqual([`/illustrations/${BOOK_ID}/page-1.png`]);
    });

    it('imagePin earliestArtAt finds no art when only narration/ objects exist', async () => {
      await generateNarration(book(), 1, 'af_heart', USER);
      expect((await getStorage().list(`${BOOK_ID}/`)).length).toBeGreaterThan(0);

      expect(await earliestArtAt(BOOK_ID)).toBeNull();
    });
  });
});
