import { Loader2, Type } from 'lucide-react'
import type { FontFamily, TextSize } from '../types'
import { FAMILY_CLASSES, FONT_LABELS, SIZE_LABELS } from '../lib/typography'

/**
 * The author-facing font + text-size picker for `/book/:id` (#113, spec
 * `per-page-font-size`).
 *
 * **Presentational only.** It holds no fetch logic and knows nothing about routes — same
 * rule as `PublishStateBar`. `BookDetail` owns `PUT /api/books/:id/typography` and replaces
 * its `book` state with the response, which is what re-renders the reader through
 * `resolveTypography`. There is deliberately no local copy of the selection: the chips read
 * straight from the book, so a failed save cannot leave the picker showing a choice the
 * server rejected.
 *
 * **Labels and family classes both come from `lib/typography.ts`.** Hand-writing a second
 * set here would let the chip advertise a face the story text does not use — the family
 * chips preview their own family, so the two maps have to be the same maps.
 *
 * **The write is free.** No spend gate on the route, so no cost label and no confirm — the
 * chip is the whole interaction.
 *
 * Class strings are written out per element rather than hoisted into shared constants so
 * every light class and its `dark:` partner sit in one literal string, which is what
 * `dark-mode-parity-check` reads.
 *
 * Tap targets are `min-h-11` + `items-center`, unconditionally — not `py-2`, and not
 * `sm:min-h-0`. A picker of chips is exactly the shape this project has shipped at 36px
 * three times (#154, #161, PR #170); the floor holds at every breakpoint here.
 */

export interface TypographyControlsProps {
  fontFamily: FontFamily
  textSize: TextSize
  onChange: (next: { font_family: FontFamily; text_size: TextSize }) => Promise<void>
  saving: boolean
}

/** Curated set, in the spec's order. Four families and four sizes — no fifth value. */
const FAMILY_ORDER: FontFamily[] = ['fredoka', 'nunito', 'atkinson', 'lexend']
const SIZE_ORDER: TextSize[] = ['cozy', 'standard', 'large', 'xlarge']

export default function TypographyControls({
  fontFamily,
  textSize,
  onChange,
  saving,
}: TypographyControlsProps) {
  return (
    <div
      data-testid="typography-controls"
      className="bg-white dark:bg-gray-800 rounded-2xl p-5 border-2 border-amber-200 dark:border-gray-700 transition-colors"
    >
      <div className="flex items-center gap-2 mb-3">
        <Type size={16} aria-hidden="true" className="text-amber-600 dark:text-amber-300" />
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 font-display">Text appearance</h3>
        {saving && (
          <span
            role="status"
            data-testid="typography-saving"
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400"
          >
            <Loader2 size={12} aria-hidden="true" className="animate-spin text-gray-500 dark:text-gray-400" />
            Saving...
          </span>
        )}
      </div>

      <div className="mb-4">
        <p id="typography-font-label" className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Font</p>
        <div role="group" aria-labelledby="typography-font-label" className="flex flex-wrap gap-2">
          {FAMILY_ORDER.map(family => {
            const selected = family === fontFamily
            return (
              <button
                key={family}
                type="button"
                data-testid="typography-chip"
                aria-pressed={selected}
                disabled={saving}
                onClick={() => void onChange({ font_family: family, text_size: textSize })}
                className={`min-h-11 px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold border-none transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400 disabled:opacity-40 disabled:cursor-default ${
                  selected
                    ? 'bg-purple-500 dark:bg-purple-500 text-white dark:text-white hover:bg-purple-600 dark:hover:bg-purple-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {/*
                  * The label renders in the family it selects — the chip IS the preview.
                  * `FAMILY_CLASSES` comes from the resolver so the two cannot diverge.
                  */}
                <span className={FAMILY_CLASSES[family]}>{FONT_LABELS[family]}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p id="typography-size-label" className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Text size</p>
        <div role="group" aria-labelledby="typography-size-label" className="flex flex-wrap gap-2">
          {SIZE_ORDER.map(size => {
            const selected = size === textSize
            return (
              <button
                key={size}
                type="button"
                data-testid="typography-chip"
                aria-pressed={selected}
                disabled={saving}
                onClick={() => void onChange({ font_family: fontFamily, text_size: size })}
                className={`min-h-11 px-4 inline-flex items-center justify-center rounded-xl text-sm font-semibold border-none transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400 disabled:opacity-40 disabled:cursor-default ${
                  selected
                    ? 'bg-purple-500 dark:bg-purple-500 text-white dark:text-white hover:bg-purple-600 dark:hover:bg-purple-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {SIZE_LABELS[size]}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
