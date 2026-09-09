import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  ageBucketFor,
  defaultTypographyForAgeRange,
  STOREFRONT_DEFAULT,
  type AgeBucket,
  type Typography,
} from '../typography';

/**
 * **Retired legacy values, not a live vocabulary.** This was `CreateBook.tsx:26`'s
 * age list before #172; `2-4` and `6-10` are no longer offerable or writable —
 * `AGE_RANGES` in `@storybook/shared` is the one canonical vocabulary and
 * `validate(GenerateRequestSchema)` rejects anything outside it on `POST
 * /api/generate`.
 *
 * These rows stay as **tolerance** cases: `ageBucketFor` reads stored strings, and
 * the read path is deliberately untightened, so a legacy row, a restored
 * `BookVersion`, or a prod row `backfillBookAgeRanges()` reported rather than
 * rewrote can still carry one of these. They also pin the property that makes the
 * backfill safe for published books — `2-4` buckets with its replacement `2-5`
 * (`early`), and `6-10` with its replacement `5-9` (`developing`), so no book's
 * typography moved when rows converged. Do not read this table as a list of values
 * the app can produce. See `.code-captain/specs/age-range-vocabulary/spec.md`.
 */
const RETIRED_CREATE_BOOK_VOCABULARY: Array<[string, AgeBucket]> = [
  ['2-4', 'early'],
  ['3-6', 'early'],
  ['4-7', 'early'],
  ['5-9', 'developing'],
  ['6-10', 'developing'],
];

/**
 * The canonical vocabulary (`AGE_RANGES`), which is the seed catalog's list by
 * user ruling. Spelled out literally here so a widened enum has to come past a
 * human; `./ageRangeVocabulary.test.ts` is the test that pins seed vs enum.
 */
const CANONICAL_VOCABULARY: Array<[string, AgeBucket]> = [
  ['2-5', 'early'],
  ['3-6', 'early'],
  ['4-7', 'early'],
  ['4-8', 'early'],
  ['5-9', 'developing'],
];

/** Off-vocabulary and never in one — the arbitrary input the parse must survive. */
const UNSEEN_INPUTS: Array<[string, AgeBucket]> = [
  ['7', 'developing'],
  ['8-12', 'independent'],
  ['10-12', 'independent'],
  ['  5-9', 'developing'], // leading whitespace is tolerated
  ['0-2', 'early'],
];

/** Nothing parseable at the front — all of these take the safe middle. */
const JUNK_INPUTS = ['', 'all ages', 'seven', '-3', 'ages 4-7', '   ', 'toddler'];

describe('ageBucketFor', () => {
  it.each(RETIRED_CREATE_BOOK_VOCABULARY)(
    'buckets retired-legacy value %s as %s',
    (ageRange, expected) => {
      expect(ageBucketFor(ageRange)).toBe(expected);
    },
  );

  it.each(CANONICAL_VOCABULARY)('buckets canonical value %s as %s', (ageRange, expected) => {
    expect(ageBucketFor(ageRange)).toBe(expected);
  });

  it.each(UNSEEN_INPUTS)(
    'buckets off-vocabulary value %s as %s by parsing its lower bound',
    (ageRange, expected) => {
      expect(ageBucketFor(ageRange)).toBe(expected);
    },
  );

  it.each(JUNK_INPUTS)(
    'buckets unparseable input %j to developing, the safe middle',
    ageRange => {
      // Never a guess at an extreme: junk must not land on `early` or
      // `independent`, whose defaults are visibly bigger/smaller than the
      // storefront default.
      expect(ageBucketFor(ageRange)).toBe('developing');
    },
  );

  it('reads the boundaries at 4/5 and 7/8', () => {
    expect(ageBucketFor('4-99')).toBe('early');
    expect(ageBucketFor('5-99')).toBe('developing');
    expect(ageBucketFor('7-99')).toBe('developing');
    expect(ageBucketFor('8-99')).toBe('independent');
  });
});

describe('defaultTypographyForAgeRange', () => {
  const CASES: Array<[string, Typography]> = [
    ['3-6', { font_family: 'fredoka', text_size: 'large' }], // early
    ['5-9', { font_family: 'fredoka', text_size: 'standard' }], // developing
    ['8-12', { font_family: 'nunito', text_size: 'cozy' }], // independent
  ];

  it.each(CASES)('seeds %s with the bucket default', (ageRange, expected) => {
    expect(defaultTypographyForAgeRange(ageRange)).toEqual(expected);
  });

  it('falls to the developing default for unparseable input', () => {
    expect(defaultTypographyForAgeRange('all ages')).toEqual({
      font_family: 'fredoka',
      text_size: 'standard',
    });
  });

  it('returns a fresh object each call, so a caller cannot mutate the table', () => {
    const first = defaultTypographyForAgeRange('3-6');
    first.text_size = 'xlarge';
    expect(defaultTypographyForAgeRange('3-6')).toEqual({
      font_family: 'fredoka',
      text_size: 'large',
    });
  });
});

describe('STOREFRONT_DEFAULT', () => {
  it('matches the Prisma column defaults on Book', () => {
    // Spec §Ruling 4: the DB defaults and this constant are the same value by
    // definition — existing rows take the column defaults on migration and must
    // render identically to a book that was never touched. Read the schema so
    // the two can't drift apart silently.
    const schema = readFileSync(
      fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url)),
      'utf8',
    );
    const fontDefault = /font_family\s+String\s+@default\("([^"]+)"\)/.exec(schema);
    const sizeDefault = /text_size\s+String\s+@default\("([^"]+)"\)/.exec(schema);

    expect(fontDefault?.[1]).toBe(STOREFRONT_DEFAULT.font_family);
    expect(sizeDefault?.[1]).toBe(STOREFRONT_DEFAULT.text_size);
  });

  it('is the developing-bucket default, so an untouched book and a mid-range new book agree', () => {
    expect(defaultTypographyForAgeRange('5-9')).toEqual(STOREFRONT_DEFAULT);
  });
});
