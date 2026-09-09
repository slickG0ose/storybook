/**
 * Typography defaults for new books (#113).
 *
 * One place decides what font family and text size a freshly created book
 * starts at. Two rulings from `.code-captain/specs/per-page-font-size/spec.md`
 * shape everything here:
 *
 * - **Ruling 3** — bucket by parsing the `age_range` string's lower bound rather
 *   than enumerating age bands. #172 has since made `AGE_RANGES` in
 *   `@storybook/shared` the one canonical vocabulary (`2-5 3-6 4-7 4-8 5-9`),
 *   enforced on write by `validate(GenerateRequestSchema)` on `POST
 *   /api/generate`, so the two divergent lists this file was written against are
 *   gone. The tolerant parse **stays** anyway, deliberately: `age_range` is still
 *   a free-text `String` column read tolerantly (`BookSchema.age_range` is
 *   `z.string()`), so an off-vocabulary value can still arrive from a legacy row,
 *   a restored `BookVersion`, or a prod row `backfillBookAgeRanges()` reports as
 *   unmapped rather than rewrites. Parsing survives all three; a match table
 *   would not. See `.code-captain/specs/age-range-vocabulary/spec.md`.
 *
 *   One consequence: the `independent` bucket is **unreachable** through the app.
 *   It needs a lower bound ≥ 8 and the canonical vocabulary tops out at `5-9`, so
 *   only a hand-written string reaches `nunito`/`cozy`. Left that way on purpose —
 *   making it reachable means widening the vocabulary, which is a product call,
 *   not a validation fix. Tracked as the `Deferred:` item in
 *   `.code-captain/specs/age-range-vocabulary/spec.md` §ADR-worthy decisions
 *   ("#113's `independent` typography bucket stays unreachable"); covered by unit
 *   tests only, in `./__tests__/typography.test.ts`.
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
 * Parses rather than matches, deliberately: writes are enum-gated since #172 but
 * reads are not, so it must still survive a stored value from outside
 * `AGE_RANGES` — a legacy row, a restored `BookVersion`, or a prod row the
 * backfill reported rather than rewrote. Unparseable input (`''`, `'all ages'`,
 * `'-3'`) buckets to `developing` — the safe middle, never a guess at an extreme.
 * See spec §Ruling 3 and the file docblock above.
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
