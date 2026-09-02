import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TypographyControls from '../TypographyControls'
import { FONT_LABELS, SIZE_LABELS } from '../../lib/typography'

/**
 * The picker for #113 (spec `per-page-font-size`, Task 8). Presentational: every test here
 * asserts what the component renders and what it hands back, never a fetch — the PUT lives
 * in `BookDetail` and is covered there.
 */

type Props = React.ComponentProps<typeof TypographyControls>

function renderControls(props: Partial<Props> = {}) {
  const onChange = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <TypographyControls
      fontFamily="fredoka"
      textSize="standard"
      onChange={onChange}
      saving={false}
      {...props}
    />
  )
  return { ...utils, onChange: props.onChange ?? onChange }
}

describe('TypographyControls', () => {
  it('renders exactly eight chips — four families and four sizes', () => {
    renderControls()
    expect(screen.getAllByTestId('typography-chip')).toHaveLength(8)

    // Labels come from lib/typography.ts, never hand-written here. Reading them from the
    // maps is what makes this test fail if the picker grows a fifth family (OpenDyslexic
    // is deliberately out of v1) or drifts to its own display strings.
    for (const label of Object.values(FONT_LABELS)) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    for (const label of Object.values(SIZE_LABELS)) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('marks exactly the selected family and size chips as pressed', () => {
    renderControls({ fontFamily: 'atkinson', textSize: 'large' })

    const pressed = screen
      .getAllByTestId('typography-chip')
      .filter(chip => chip.getAttribute('aria-pressed') === 'true')
      .map(chip => chip.textContent)

    expect(pressed).toEqual([FONT_LABELS.atkinson, SIZE_LABELS.large])
  })

  it('gives the selected chip the filled styling and the rest the muted pair', () => {
    renderControls({ fontFamily: 'nunito', textSize: 'standard' })

    const selected = screen.getByRole('button', { name: FONT_LABELS.nunito })
    expect(selected.className).toContain('bg-purple-500')
    expect(selected.className).toContain('dark:bg-purple-500')

    const unselected = screen.getByRole('button', { name: FONT_LABELS.lexend })
    expect(unselected.className).toContain('bg-gray-100')
    expect(unselected.className).toContain('dark:bg-gray-700')
    expect(unselected.className).toContain('text-gray-600')
    expect(unselected.className).toContain('dark:text-gray-300')
  })

  it('previews each family by rendering its own label in that family', () => {
    renderControls()
    // The chip is the preview, so the label span carries the family utility the resolver
    // would apply to the story text. `font-display` / `font-body` are the incumbents'
    // pre-existing names — `font-fredoka` does not exist.
    const cases: Array<[string, string]> = [
      [FONT_LABELS.fredoka, 'font-display'],
      [FONT_LABELS.nunito, 'font-body'],
      [FONT_LABELS.atkinson, 'font-atkinson'],
      [FONT_LABELS.lexend, 'font-lexend'],
    ]
    for (const [label, cls] of cases) {
      const span = screen.getByText(label)
      expect(span.className).toBe(cls)
    }
  })

  it('preserves the current size when a family chip is clicked', () => {
    const { onChange } = renderControls({ fontFamily: 'fredoka', textSize: 'xlarge' })
    fireEvent.click(screen.getByRole('button', { name: FONT_LABELS.lexend }))
    expect(onChange).toHaveBeenCalledWith({ font_family: 'lexend', text_size: 'xlarge' })
  })

  it('preserves the current family when a size chip is clicked', () => {
    const { onChange } = renderControls({ fontFamily: 'atkinson', textSize: 'standard' })
    fireEvent.click(screen.getByRole('button', { name: SIZE_LABELS.cozy }))
    expect(onChange).toHaveBeenCalledWith({ font_family: 'atkinson', text_size: 'cozy' })
  })

  it('disables every chip and shows a status while saving', () => {
    const { onChange } = renderControls({ saving: true })

    for (const chip of screen.getAllByTestId('typography-chip')) {
      expect(chip).toBeDisabled()
    }
    expect(screen.getByTestId('typography-saving')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: FONT_LABELS.lexend }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('holds every chip at the 44px tap floor without leaning on vertical padding', () => {
    // This project has shipped 36px controls three times (#154, #161, PR #170) and a row
    // of chips is the exact shape that goes wrong. jsdom computes no layout, so this pins
    // the class rather than the height — it catches the realistic regression (someone
    // swaps `min-h-11` for `py-2` while tidying) and does not pretend to be the
    // measurement `expectTapTargets` does in the mobile e2e spec.
    renderControls()
    for (const chip of screen.getAllByTestId('typography-chip')) {
      expect(chip.className).toContain('min-h-11')
      expect(chip.className).toContain('items-center')
      expect(chip.className).not.toMatch(/\bpy-\d/)
      // `sm:min-h-0` would drop the floor on exactly the tablet width where the chips are
      // still finger-driven. The floor is unconditional here.
      expect(chip.className).not.toContain('sm:min-h-0')
    }
  })
})
