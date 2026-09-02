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
 * Both vocabularies that exist in the repo today, table-driven so a third one can
 * be added as rows rather than as new cases. `CreateBook.tsx:26` offers the first
 * set; `server/prisma/seed.ts` uses the second. They disagree — that divergence is
 * the reason `ageBucketFor` parses instead of matching (spec §Ruling 3).
 */
const CREATE_BOOK_VOCABULARY: Array<[string, AgeBucket]> = [
  ['2-4', 'early'],
  ['3-6', 'early'],
  ['4-7', 'early'],
  ['5-9', 'developing'],
  ['6-10', 'developing'],
];

const SEED_VOCABULARY: Array<[string, AgeBucket]> = [
  ['2-5', 'early'],
  ['3-6', 'early'],
  ['4-7', 'early'],
  ['4-8', 'early'],
  ['5-9', 'developing'],
];

/** Values from neither vocabulary — the third vocabulary this must survive. */
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
  it.each(CREATE_BOOK_VOCABULARY)(
    'buckets CreateBook.tsx value %s as %s',
    (ageRange, expected) => {
      expect(ageBucketFor(ageRange)).toBe(expected);
    },
  );

  it.each(SEED_VOCABULARY)('buckets seed.ts value %s as %s', (ageRange, expected) => {
    expect(ageBucketFor(ageRange)).toBe(expected);
  });

  it.each(UNSEEN_INPUTS)(
    'buckets unseen-vocabulary value %s as %s by parsing its lower bound',
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
