/**
 * Typography defaults for new books (#113).
 *
 * One place decides what font family and text size a freshly created book
 * starts at. Two rulings from `.code-captain/specs/per-page-font-size/spec.md`
 * shape everything here:
 *
 * - **Ruling 3** — `age_range` is a free-text column and this repo carries two
 *   divergent vocabularies for it (`CreateBook.tsx` offers `2-4 3-6 4-7 5-9
 *   6-10`; `seed.ts` uses `2-5 3-6 4-7 4-8 5-9`). So we bucket by parsing the
 *   string's lower bound rather than enumerating age bands — no new enum to keep
 *   in sync, and it survives a third vocabulary and a later normalisation of the
 *   column unchanged.
 * - **Ruling 4** — these defaults are a *creation-time seed value*, never a
 *   runtime fallback. Nothing may re-derive typography for a book that already
 *   exists: an author's book must not change appearance because a default moved.
 *   The DB columns are non-null with defaults equal to `STOREFRONT_DEFAULT`.
 */

import type { FontFamily, TextSize } from '@storybook/shared';

/** Reading stage inferred from a book's `age_range` string. */
export type AgeBucket = 'early' | 'developing' | 'independent';

/** The presentation pair carried on every `Book` row. */
export interface Typography {
  font_family: FontFamily;
  text_size: TextSize;
}

/**
 * What an untouched book renders as, and what the Prisma columns default to.
 *
 * `fredoka` + `standard` is defined to emit today's exact class string, so every
 * pre-#113 row is visually unchanged. Keep this in lockstep with the
 * `@default(...)` values on `Book.font_family` / `Book.text_size` — a test pins
 * the two together against `schema.prisma`.
 */
export const STOREFRONT_DEFAULT: Typography = {
  font_family: 'fredoka',
  text_size: 'standard',
};

/** Creation-time defaults per bucket. See spec §Size scale. */
const BUCKET_DEFAULTS: Record<AgeBucket, Typography> = {
  early: { font_family: 'fredoka', text_size: 'large' },
  developing: { font_family: 'fredoka', text_size: 'standard' },
  independent: { font_family: 'nunito', text_size: 'cozy' },
};

/** Leading run of digits, after optional whitespace. A leading `-` does not match. */
const LOWER_BOUND = /^\s*(\d+)/;

/**
 * Buckets an `age_range` string by the integer it starts with
 * (`'4-7'` → 4, `'2-5'` → 2, `'  10-12'` → 10).
 *
 * Lower bound ≤ 4 → `early`; 5–7 → `developing`; ≥ 8 → `independent`.
 *
 * Parses rather than matches, deliberately: it must survive both vocabularies in
 * the repo today and any third that shows up. Unparseable input (`''`,
 * `'all ages'`, `'-3'`) buckets to `developing` — the safe middle, never a guess
 * at an extreme. See spec §Ruling 3.
 */
export function ageBucketFor(ageRange: string): AgeBucket {
  const match = LOWER_BOUND.exec(ageRange ?? '');
  if (!match) return 'developing';

  const lowerBound = Number.parseInt(match[1], 10);
  if (!Number.isFinite(lowerBound)) return 'developing';

  if (lowerBound <= 4) return 'early';
  if (lowerBound <= 7) return 'developing';
  return 'independent';
}

/**
 * The typography a **new** book is created with, derived from its age range.
 *
 * Creation-time seed value only — `generate.ts` spreads this into
 * `prisma.book.create`. NEVER call it as a runtime fallback for an existing
 * book: the columns are non-null, so an existing book always has its own stored
 * values, and re-deriving them would change a published author's book under
 * them. See spec §Ruling 4.
 */
export function defaultTypographyForAgeRange(ageRange: string): Typography {
  return { ...BUCKET_DEFAULTS[ageBucketFor(ageRange)] };
}
