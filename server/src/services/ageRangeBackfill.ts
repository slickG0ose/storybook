import { AGE_RANGES, type AgeRange } from '@storybook/shared';
import prisma from '../db/prisma';

/**
 * One-time-per-boot convergence of `Book.age_range` onto the canonical
 * vocabulary (spec: .code-captain/specs/age-range-vocabulary/spec.md).
 *
 * `CreateBook.tsx` used to offer `2-4` and `6-10`, which `seed.ts` never wrote
 * and the Home facet list never expected, so an author who picked one landed
 * their book in a facet no other book occupies. The enum now gates writes, but
 * that does nothing for rows already stored — this converges those.
 *
 * A boot-time pass rather than a Prisma migration on purpose: `render.yaml`
 * deploys with `prisma db push`, never `migrate deploy`, so a `migrations/`
 * folder would converge `dev.db` and `test.db` and silently never reach
 * production. See spec §"Alternatives considered".
 *
 * Self-limiting by construction. Once writes are enum-gated no new
 * off-vocabulary row can appear, so the steady state is one `findMany` and zero
 * writes, on every boot, forever.
 *
 * Never deletes a row, never merges two, and never guesses at a value it was
 * not told about. Best-effort at boot: a failure is logged, never fatal.
 */

/**
 * Legacy client vocabulary → canonical. Both sides of each pair bucket
 * identically in `ageBucketFor()`, so no book's typography can move: `2-4` and
 * `2-5` are both `early` (lower bound ≤ 4); `6-10` and `5-9` are both
 * `developing` (5–7). That property is what makes rewriting an
 * already-published book safe, and a test pins it.
 *
 * Deliberately exactly two entries. Any other off-vocabulary value is reported
 * in `unmapped`, never rewritten — the same discipline as
 * `backfillUserEmails()` reporting collisions instead of picking a winner.
 */
export const LEGACY_AGE_RANGE_MAP: Record<string, AgeRange> = {
  '2-4': '2-5',
  '6-10': '5-9',
};

/**
 * Derived from `AGE_RANGES` rather than restated, so widening the vocabulary
 * later cannot leave this check behind holding the old list.
 */
const CANONICAL = new Set<string>(AGE_RANGES);

export interface AgeRangeBackfillResult {
  /** Book ids rewritten this boot, with the value they moved from and to. */
  rewritten: Array<{ id: string; from: string; to: AgeRange }>;
  /** Off-vocabulary values NOT in the map — reported, never guessed at. */
  unmapped: Array<{ id: string; age_range: string }>;
}

/**
 * Rewrite the two legacy `age_range` values onto their canonical partners.
 *
 * Only `age_range` is written; `font_family`, `text_size`, and every other
 * column on the row are untouched, which is what keeps an already-published
 * book rendering exactly as it did (#113 §Ruling 4).
 */
export async function backfillBookAgeRanges(): Promise<AgeRangeBackfillResult> {
  // No `deleted_at` filter, and that is mandatory rather than a preference: a
  // tombstoned book can be restored, and a stale `6-10` would come back with
  // it — reintroducing the drift after this service had already reported the
  // table converged.
  const rows = await prisma.book.findMany({
    select: { id: true, age_range: true },
  });

  const result: AgeRangeBackfillResult = { rewritten: [], unmapped: [] };

  for (const row of rows) {
    const mapped = LEGACY_AGE_RANGE_MAP[row.age_range];

    if (mapped) {
      await prisma.book.update({
        where: { id: row.id },
        data: { age_range: mapped },
      });
      result.rewritten.push({ id: row.id, from: row.age_range, to: mapped });
      continue;
    }

    if (CANONICAL.has(row.age_range)) continue;

    // Anything the map does not name is left exactly as it is, and reported so
    // a human can decide. An `all ages` or a stray `3-5` could plausibly map
    // several ways, and choosing one here would be a silent data edit.
    result.unmapped.push({ id: row.id, age_range: row.age_range });
  }

  if (result.rewritten.length > 0) {
    console.log(
      `[age-range-backfill] rewrote ${result.rewritten.length}: ` +
        result.rewritten.map(r => `${r.id} (${r.from} → ${r.to})`).join(', '),
    );
  }

  if (result.unmapped.length > 0) {
    // This service reports itself — the caller only handles failure, matching
    // backfillUserEmails() and reconcileAdmins(). An off-vocabulary row is not
    // an error: the read path stays tolerant (`BookSchema.age_range` is still
    // `z.string()`), so the book serves fine; it just sits in a facet the Home
    // filter will not offer.
    console.warn(
      `[age-range-backfill] ${result.unmapped.length} off-vocabulary row(s) left untouched: ` +
        result.unmapped.map(r => `${r.id} (${r.age_range})`).join(', '),
    );
  }

  return result;
}
