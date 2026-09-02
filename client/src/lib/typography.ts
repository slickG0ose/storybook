import type { FontFamily, TextSize } from '../types'

/**
 * Token -> Tailwind class resolution for story text (#113, spec `per-page-font-size`).
 *
 * EVERY class below is written as a LITERAL string. Tailwind v4 discovers utilities by
 * scanning source text, so a computed name — `font-${token}` or `text-${step}` — emits no
 * utility at all and the style silently never applies, with no build error anywhere. That
 * is the single highest-risk failure mode in this file: do not "simplify" these maps into
 * template literals, and do not split a class across a concatenation.
 *
 * Note the two incumbent families keep their pre-existing utility names: Fredoka is
 * `font-display` and Nunito is `font-body` (`--font-display` / `--font-body` in
 * `index.css`). `font-fredoka` and `font-nunito` do not exist — renaming the theme tokens
 * to match would restyle every non-story surface in the app.
 */

/**
 * The resolved value is a Tailwind class string, applied directly to the story `<p>`.
 * Named so the seam in the spec's signature is honoured; it is deliberately an alias for
 * `string` rather than an object, because every call site (`StoryText`'s `textClassName`)
 * consumes it as a className and the pin test compares it by string equality.
 */
export type ResolvedTypography = string

/**
 * Only the fields the resolver reads — so a raw Book, a hydrated one, or a test fixture
 * are all assignable.
 */
export interface TypographySource {
  font_family: FontFamily
  text_size: TextSize
}

/**
 * The DB defaults, which are defined to reproduce the pre-#113 rendering exactly.
 *
 * These exist because the resolvers must not be able to blank the page. The columns are
 * non-null server-side and `hydrateBook` spreads the whole row, so in the happy path a
 * book always carries both tokens — but "the server guarantees it" is not the same as "it
 * is always there". A book row cached by the service worker before the migration, a
 * response from a stale offline cache, or a fixture written against the older shape all
 * yield `undefined`, and indexing a Record with that returns `undefined` too. Dereferencing
 * `.scale` on it throws inside render, React unmounts the tree, and the reader goes blank —
 * a silent total failure in exchange for a missing font preference.
 *
 * So both resolvers fall back to these instead. An unknown token degrades to the default
 * rendering, which is the same thing every un-customised book shows.
 */
const DEFAULT_FAMILY: FontFamily = 'fredoka'
const DEFAULT_SIZE: TextSize = 'standard'

/**
 * Colour is constant across every token — the picker changes family and size only, never
 * contrast. Both halves of the dark-mode pair live here so no caller can forget one.
 */
const TEXT_COLOR_CLASSES = 'text-gray-700 dark:text-gray-200'

/**
 * Size is a triple, not a font-size: each step sets scale, line-height and (from `large`
 * up) tracking together. `scale` and `spacing` are separate because the colour classes sit
 * between them in the string this must reproduce exactly — see `resolveTypography`.
 */
const SIZE_CLASSES: Record<TextSize, { scale: string; spacing: string }> = {
  cozy: { scale: 'text-sm md:text-base', spacing: 'leading-relaxed' },
  standard: { scale: 'text-base md:text-lg', spacing: 'leading-relaxed' },
  large: { scale: 'text-lg md:text-xl', spacing: 'leading-loose tracking-wide' },
  xlarge: { scale: 'text-xl md:text-2xl', spacing: 'leading-loose tracking-wide' },
}

/**
 * Exported so the picker can render each family chip's label IN that family — the preview
 * IS the affordance. Deliberately shared rather than re-typed in `TypographyControls`:
 * a second copy would drift from the resolver and the chip would advertise a face the
 * story text does not use. Same reasoning as `FONT_LABELS` below.
 */
export const FAMILY_CLASSES: Record<FontFamily, string> = {
  fredoka: 'font-display',
  nunito: 'font-body',
  atkinson: 'font-atkinson',
  lexend: 'font-lexend',
}

/** Chip labels for the picker. Family labels read as the family's own name. */
export const FONT_LABELS: Record<FontFamily, string> = {
  fredoka: 'Fredoka',
  nunito: 'Nunito',
  atkinson: 'Atkinson Hyperlegible',
  lexend: 'Lexend',
}

export const SIZE_LABELS: Record<TextSize, string> = {
  cozy: 'Cozy',
  standard: 'Standard',
  large: 'Large',
  xlarge: 'Extra large',
}

/**
 * Resolves a book's typography tokens to the story-text className.
 *
 * `fredoka` + `standard` must emit exactly
 * `text-base md:text-lg text-gray-700 dark:text-gray-200 leading-relaxed font-display`
 * — the string hard-coded in `BookSpread` before #113. That equality is pinned by a unit
 * test and is the mechanical proof that every existing book renders identically; the class
 * ORDER here is therefore load-bearing, not cosmetic.
 *
 * @param page The seam for per-page overrides (spec §Ruling 1). UNUSED in v1 and
 *   deliberately kept: the deferred override lands as a one-line merge here rather than a
 *   signature change through every call site. Do not delete it as dead weight.
 */
export function resolveTypography(
  book: TypographySource,
  page?: Partial<TypographySource>,
): ResolvedTypography {
  void page

  const size = SIZE_CLASSES[book.text_size] ?? SIZE_CLASSES[DEFAULT_SIZE]
  const family = FAMILY_CLASSES[book.font_family] ?? FAMILY_CLASSES[DEFAULT_FAMILY]

  return `${size.scale} ${TEXT_COLOR_CLASSES} ${size.spacing} ${family}`
}

/**
 * Reader view's own size scale (#113, Task 8b).
 *
 * A SEPARATE map, not a `view` flag on `SIZE_CLASSES`, because the two scales genuinely
 * disagree: Reader view has always rendered a single full-width column at `text-xl`, which
 * is LARGER than the spread's `standard` (`text-base md:text-lg`). Reusing the spread map
 * here would shrink the reader text of every existing book — the exact no-visual-change
 * breach this feature is built to avoid. `standard` therefore pins today's `text-xl`, and
 * the other steps are relative to it.
 *
 * No `md:` step: Reader view is one column at every width today and this task does not add
 * a responsive break. Line-height and tracking DO mirror the spread map, because those are
 * part of what a size token MEANS (see spec §Text-size scale) — `large` promises looser
 * leading in both views or the token means two different things depending on a toggle.
 *
 * Literal strings only, same Tailwind v4 tree-shaking trap as above.
 */
const READER_SIZE_CLASSES: Record<TextSize, { scale: string; spacing: string }> = {
  cozy: { scale: 'text-lg', spacing: 'leading-relaxed' },
  standard: { scale: 'text-xl', spacing: 'leading-relaxed' },
  large: { scale: 'text-2xl', spacing: 'leading-loose tracking-wide' },
  xlarge: { scale: 'text-3xl', spacing: 'leading-loose tracking-wide' },
}

/**
 * Resolves a book's typography tokens to Reader view's story-text className
 * (`BookDetail`'s single-page column).
 *
 * `fredoka` + `standard` emits exactly
 * `text-xl text-gray-700 dark:text-gray-200 leading-relaxed font-display` — the string
 * Reader view hard-coded before #113 PLUS the family class, and differing in nothing else.
 *
 * That one addition is a deliberate, visible change: Reader view set no family, so it
 * inherited `body` (Nunito) while Spread view rendered `font-display` (Fredoka). The two
 * views have always disagreed about the face. A picker sitting beside a view toggle has to
 * affect both views, so the family now applies here too and a default book's reader text
 * moves Nunito -> Fredoka. Reverting is a one-line drop of `${family}` from the return.
 *
 * @param page The same deferred per-page seam as `resolveTypography` (spec §Ruling 1).
 */
export function resolveReaderTypography(
  book: TypographySource,
  page?: Partial<TypographySource>,
): ResolvedTypography {
  void page

  const size = READER_SIZE_CLASSES[book.text_size] ?? READER_SIZE_CLASSES[DEFAULT_SIZE]
  const family = FAMILY_CLASSES[book.font_family] ?? FAMILY_CLASSES[DEFAULT_FAMILY]

  return `${size.scale} ${TEXT_COLOR_CLASSES} ${size.spacing} ${family}`
}
