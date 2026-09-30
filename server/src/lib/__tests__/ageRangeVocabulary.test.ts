import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { AGE_RANGES } from '@storybook/shared';

/**
 * Anti-drift catch-net for the canonical age-range vocabulary (#172).
 *
 * The seed catalog IS the canonical list — user ruling, 2026-09-09 — so the two
 * are the same set by definition. Nothing in the type system connects a string
 * literal in `seed.ts` to `AGE_RANGES`, and that gap is exactly how the repo
 * once ended up with two conflicting age lists in the first place. Read the seed as
 * text so a new book with an off-list age range, or a widened enum with no book
 * behind it, fails here instead of shipping.
 *
 * Modelled on the STOREFRONT_DEFAULT test in ./typography.test.ts, which pins a
 * constant against schema.prisma the same way.
 */
function seedAgeRangeLiterals(): string[] {
  const seed = readFileSync(
    fileURLToPath(new URL('../../../prisma/seed.ts', import.meta.url)),
    'utf8',
  );
  return [...seed.matchAll(/age_range:\s*'([^']*)'/g)].map(m => m[1]);
}

describe('age-range vocabulary vs server/prisma/seed.ts', () => {
  it('finds age_range literals in the seed at all', () => {
    // Guard the regex itself: a seed refactor to double quotes or a computed
    // value would otherwise make every assertion below vacuously pass.
    expect(seedAgeRangeLiterals().length).toBeGreaterThan(0);
  });

  it('every seeded age_range is a member of AGE_RANGES', () => {
    for (const value of seedAgeRangeLiterals()) {
      expect(AGE_RANGES).toContain(value);
    }
  });

  it('the seeded set is exactly AGE_RANGES — no canonical value lacks a book', () => {
    const seeded = [...new Set(seedAgeRangeLiterals())].sort();
    expect(seeded).toEqual([...AGE_RANGES].sort());
  });

  it('retired client-only values never reappear in the seed', () => {
    // '2-4' and '6-10' were CreateBook.tsx-only strays; the backfill maps them
    // away. If one shows up here, the vocabulary regressed.
    const seeded = new Set(seedAgeRangeLiterals());
    expect(seeded.has('2-4')).toBe(false);
    expect(seeded.has('6-10')).toBe(false);
  });
});
