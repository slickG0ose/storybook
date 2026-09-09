import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { ageBucketFor } from '../../lib/typography';
import { backfillBookAgeRanges, LEGACY_AGE_RANGE_MAP } from '../ageRangeBackfill';

/**
 * Behaviour table for `backfillBookAgeRanges()`
 * (spec: .code-captain/specs/age-range-vocabulary/spec.md, Task 4).
 *
 * Legacy rows are seeded with `prisma.book.create` rather than through
 * POST /api/generate, because that route is now enum-gated and could not
 * produce the `2-4` / `6-10` rows this exists to converge.
 */

let n = 0;

async function seedBook(opts: {
  age_range: string;
  deletedAt?: Date | null;
  font_family?: string;
  text_size?: string;
}): Promise<string> {
  n += 1;
  const row = await prisma.book.create({
    data: {
      id: `legacy-book-${n}`,
      title: `Legacy Book ${n}`,
      author: 'AI Storybook',
      description: 'A story.',
      theme: 'fantasy',
      age_range: opts.age_range,
      cover_emoji: '\u{1F31F}',
      cover_color: '#7c3aed',
      price: 19.99,
      deleted_at: opts.deletedAt ?? null,
      ...(opts.font_family ? { font_family: opts.font_family } : {}),
      ...(opts.text_size ? { text_size: opts.text_size } : {}),
    },
  });
  return row.id;
}

async function rangeOf(id: string): Promise<string | undefined> {
  const row = await prisma.book.findUnique({ where: { id } });
  return row?.age_range;
}

describe('backfillBookAgeRanges', () => {
  beforeEach(async () => {
    await resetDatabase();
    // Off-vocabulary rows warn by design; keep the suite output readable.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrites 2-4 → 2-5 and 6-10 → 5-9 and reports them in rewritten', async () => {
    const early = await seedBook({ age_range: '2-4' });
    const developing = await seedBook({ age_range: '6-10' });

    const result = await backfillBookAgeRanges();

    expect(result.unmapped).toEqual([]);
    expect(result.rewritten).toEqual(
      expect.arrayContaining([
        { id: early, from: '2-4', to: '2-5' },
        { id: developing, from: '6-10', to: '5-9' },
      ]),
    );
    expect(result.rewritten).toHaveLength(2);
    expect(await rangeOf(early)).toBe('2-5');
    expect(await rangeOf(developing)).toBe('5-9');
  });

  it('leaves an unmapped off-vocabulary value untouched and reports it', async () => {
    const allAges = await seedBook({ age_range: 'all ages' });
    const stray = await seedBook({ age_range: '3-5' });

    const result = await backfillBookAgeRanges();

    expect(result.rewritten).toEqual([]);
    expect(result.unmapped).toEqual(
      expect.arrayContaining([
        { id: allAges, age_range: 'all ages' },
        { id: stray, age_range: '3-5' },
      ]),
    );
    expect(result.unmapped).toHaveLength(2);
    // The never-guess rule: reported, and still stored exactly as written.
    expect(await rangeOf(allAges)).toBe('all ages');
    expect(await rangeOf(stray)).toBe('3-5');
  });

  it('rewrites a soft-deleted book too', async () => {
    // No `deleted_at` filter on purpose: a tombstone can be restored, and a
    // stale value would come back with it.
    const tombstoned = await seedBook({ age_range: '6-10', deletedAt: new Date() });

    const result = await backfillBookAgeRanges();

    expect(result.rewritten).toEqual([{ id: tombstoned, from: '6-10', to: '5-9' }]);
    expect(await rangeOf(tombstoned)).toBe('5-9');
    // Still a tombstone — the backfill writes age_range and nothing else.
    const row = await prisma.book.findUnique({ where: { id: tombstoned } });
    expect(row?.deleted_at).not.toBeNull();
  });

  it('is a no-op on the canonical seed catalog, and idempotent', async () => {
    const before = await prisma.book.findMany({
      select: { id: true, age_range: true },
      orderBy: { id: 'asc' },
    });
    expect(before.length).toBeGreaterThan(0);

    expect(await backfillBookAgeRanges()).toEqual({ rewritten: [], unmapped: [] });
    expect(await backfillBookAgeRanges()).toEqual({ rewritten: [], unmapped: [] });

    const after = await prisma.book.findMany({
      select: { id: true, age_range: true },
      orderBy: { id: 'asc' },
    });
    expect(after).toEqual(before);
  });

  it('logs proof of life on a clean pass, so silence never means "never deployed"', async () => {
    const log = vi.mocked(console.log);
    log.mockClear();

    const total = await prisma.book.count();
    expect(await backfillBookAgeRanges()).toEqual({ rewritten: [], unmapped: [] });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('[age-range-backfill]');
    expect(log.mock.calls[0][0]).toContain(`${total} book(s) checked`);
  });

  it('is idempotent after a rewrite — a second run reports nothing', async () => {
    await seedBook({ age_range: '2-4' });

    expect(await backfillBookAgeRanges()).toHaveProperty('rewritten.length', 1);
    expect(await backfillBookAgeRanges()).toEqual({ rewritten: [], unmapped: [] });
  });

  it('does not move a rewritten book typography — same bucket, same columns', async () => {
    // The property that makes the rewrite safe for an already-published book:
    // both sides of each mapped pair bucket identically, so nothing that reads
    // age_range for presentation can produce a different answer afterwards.
    expect(ageBucketFor('2-4')).toBe(ageBucketFor('2-5'));
    expect(ageBucketFor('6-10')).toBe(ageBucketFor('5-9'));
    expect(ageBucketFor('2-4')).toBe('early');
    expect(ageBucketFor('6-10')).toBe('developing');

    // And every pair in the map holds it, so adding an entry that breaks the
    // property fails here rather than silently re-typesetting someone's book.
    for (const [from, to] of Object.entries(LEGACY_AGE_RANGE_MAP)) {
      expect(ageBucketFor(from)).toBe(ageBucketFor(to));
    }

    const id = await seedBook({ age_range: '6-10', font_family: 'nunito', text_size: 'cozy' });
    const before = await prisma.book.findUnique({ where: { id } });

    await backfillBookAgeRanges();

    const after = await prisma.book.findUnique({ where: { id } });
    expect(after?.font_family).toBe(before?.font_family);
    expect(after?.text_size).toBe(before?.text_size);
    expect(after?.font_family).toBe('nunito');
    expect(after?.text_size).toBe('cozy');
    expect(after?.age_range).toBe('5-9');
  });
});
