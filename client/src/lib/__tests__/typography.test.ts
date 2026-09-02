import { describe, it, expect } from 'vitest'
import type { FontFamily, TextSize } from '@storybook/shared'
import {
  resolveTypography,
  resolveReaderTypography,
  FONT_LABELS,
  SIZE_LABELS,
  type TypographySource,
} from '../typography'

const FAMILIES: FontFamily[] = ['fredoka', 'nunito', 'atkinson', 'lexend']
const SIZES: TextSize[] = ['cozy', 'standard', 'large', 'xlarge']

function source(overrides: Partial<TypographySource> = {}): TypographySource {
  return { font_family: 'fredoka', text_size: 'standard', ...overrides }
}

describe('resolveTypography', () => {
  // THE PIN. This exact string is what BookSpread hard-coded before #113, so this
  // assertion is the mechanical discharge of the no-visual-change constraint: every
  // existing book carries the DB defaults fredoka/standard and must render identically.
  // If this test ever needs editing to pass, the constraint has been broken — fix the
  // resolver, not the expectation.
  it('resolves the defaults to the pre-#113 class string, unchanged and in order', () => {
    expect(resolveTypography({ font_family: 'fredoka', text_size: 'standard' })).toBe(
      'text-base md:text-lg text-gray-700 dark:text-gray-200 leading-relaxed font-display',
    )
  })

  it('maps every family to its Tailwind utility, keeping the incumbent names', () => {
    expect(resolveTypography(source({ font_family: 'fredoka' }))).toContain('font-display')
    expect(resolveTypography(source({ font_family: 'nunito' }))).toContain('font-body')
    expect(resolveTypography(source({ font_family: 'atkinson' }))).toContain('font-atkinson')
    expect(resolveTypography(source({ font_family: 'lexend' }))).toContain('font-lexend')
  })

  it('sets scale, line-height and tracking together for each size step', () => {
    expect(resolveTypography(source({ text_size: 'cozy' }))).toBe(
      'text-sm md:text-base text-gray-700 dark:text-gray-200 leading-relaxed font-display',
    )
    expect(resolveTypography(source({ text_size: 'large' }))).toBe(
      'text-lg md:text-xl text-gray-700 dark:text-gray-200 leading-loose tracking-wide font-display',
    )
    expect(resolveTypography(source({ text_size: 'xlarge' }))).toBe(
      'text-xl md:text-2xl text-gray-700 dark:text-gray-200 leading-loose tracking-wide font-display',
    )
  })

  it('emits a dark-mode colour partner and exactly one font utility for all 16 combinations', () => {
    for (const font_family of FAMILIES) {
      for (const text_size of SIZES) {
        const className = resolveTypography({ font_family, text_size })
        const fontUtilities = className.match(/(?:^|\s)font-[a-z]+/g) ?? []

        expect(className, `${font_family}/${text_size}`).not.toBe('')
        expect(className, `${font_family}/${text_size}`).toContain('text-gray-700')
        expect(className, `${font_family}/${text_size}`).toContain('dark:text-gray-200')
        expect(fontUtilities, `${font_family}/${text_size}`).toHaveLength(1)
      }
    }
  })

  it('ignores the page argument in v1 — it is the deferred per-page seam', () => {
    const book = source({ font_family: 'nunito', text_size: 'cozy' })

    expect(resolveTypography(book, { text_size: 'xlarge' })).toBe(resolveTypography(book))
    expect(resolveTypography(book, {})).toBe(resolveTypography(book))
  })
})

describe('picker labels', () => {
  it('labels every family and every size token', () => {
    for (const family of FAMILIES) expect(FONT_LABELS[family]).toBeTruthy()
    for (const size of SIZES) expect(SIZE_LABELS[size]).toBeTruthy()
  })
})

describe('resolveReaderTypography', () => {
  // THE READER PIN (#113 Task 8b). Reader view hard-coded
  // `text-xl text-gray-700 dark:text-gray-200 leading-relaxed` before this task. The
  // expectation below is that string plus `font-display` and NOTHING else: the size is
  // preserved exactly, and the single addition is the family, which Reader view never set
  // (it inherited Nunito from `body` while the spread rendered Fredoka). That family
  // change is deliberate and is the one visible difference this task ships.
  it('resolves the defaults to the pre-#113 reader string plus the family class', () => {
    expect(resolveReaderTypography({ font_family: 'fredoka', text_size: 'standard' })).toBe(
      'text-xl text-gray-700 dark:text-gray-200 leading-relaxed font-display',
    )
  })

  it('steps the reader scale relative to text-xl, with no md: break', () => {
    expect(resolveReaderTypography(source({ text_size: 'cozy' }))).toBe(
      'text-lg text-gray-700 dark:text-gray-200 leading-relaxed font-display',
    )
    expect(resolveReaderTypography(source({ text_size: 'large' }))).toBe(
      'text-2xl text-gray-700 dark:text-gray-200 leading-loose tracking-wide font-display',
    )
    expect(resolveReaderTypography(source({ text_size: 'xlarge' }))).toBe(
      'text-3xl text-gray-700 dark:text-gray-200 leading-loose tracking-wide font-display',
    )
    // Reader view is one column at every width today; adding a responsive step here would
    // be a design change this task does not make.
    for (const text_size of SIZES) {
      expect(resolveReaderTypography(source({ text_size })), text_size).not.toContain('md:')
    }
  })

  it('applies every family, so the picker moves the reader as well as the spread', () => {
    expect(resolveReaderTypography(source({ font_family: 'nunito' }))).toContain('font-body')
    expect(resolveReaderTypography(source({ font_family: 'atkinson' }))).toContain('font-atkinson')
    expect(resolveReaderTypography(source({ font_family: 'lexend' }))).toContain('font-lexend')
  })

  // The only thing that catches one map being aliased to the other: if READER_SIZE_CLASSES
  // were ever pointed at SIZE_CLASSES (or vice versa), every size token would resolve
  // identically in both views and Reader's larger scale would silently vanish.
  it('yields a different size class from the spread for the same book, at every size', () => {
    for (const text_size of SIZES) {
      const book = source({ text_size })
      const sizeOf = (className: string) => className.split(' text-gray-700')[0]

      expect(sizeOf(resolveReaderTypography(book)), text_size).not.toBe(
        sizeOf(resolveTypography(book)),
      )
    }
  })

  it('ignores the page argument in v1, matching the spread resolver', () => {
    const book = source({ font_family: 'lexend', text_size: 'large' })

    expect(resolveReaderTypography(book, { text_size: 'cozy' })).toBe(resolveReaderTypography(book))
  })
})
