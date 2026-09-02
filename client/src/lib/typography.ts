import type { FontFamily, TextSize } from '@storybook/shared'

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

  const size = SIZE_CLASSES[book.text_size]
  const family = FAMILY_CLASSES[book.font_family]

  return `${size.scale} ${TEXT_COLOR_CLASSES} ${size.spacing} ${family}`
}
