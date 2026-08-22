import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import NarrationPlayer from '../NarrationPlayer'
import { DEFAULT_PREFS, RATE_OPTIONS } from '../../lib/narration/prefs'
import type { NarrationVoice } from '../../lib/narration/types'
import type { UseNarrationResult } from '../../hooks/useNarration'

/**
 * The player is driven by a hand-built `UseNarrationResult` rather than the real hook:
 * the state machine has its own suite (`useNarration.test.tsx`), and rendering assertions
 * that have to first drive a fake speech engine into the right state are testing the
 * wrong thing.
 *
 * The factory's return type is annotated on purpose — an unannotated object literal would
 * still type-check after `UseNarrationResult` grows a field, and the mock would silently
 * go stale (see `docs/conventions/testing.md`).
 */
function makeNarration(overrides: Partial<UseNarrationResult> = {}): UseNarrationResult {
  return {
    state: 'idle',
    position: null,
    chunks: [],
    needsGesture: false,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    nextSentence: vi.fn(),
    previousSentence: vi.fn(),
    prefs: { ...DEFAULT_PREFS },
    setPrefs: vi.fn(),
    voices: [],
    voiceStatus: 'ready',
    ...overrides,
  }
}

const VOICES: NarrationVoice[] = [
  { uri: 'voice-a', name: 'Alice', lang: 'en-US', localService: true, isDefault: true },
  { uri: 'voice-b', name: 'Bruno', lang: 'en-GB', localService: false, isDefault: false },
]

describe('NarrationPlayer', () => {
  it('renders the four transport controls and routes each to its handler', async () => {
    const narration = makeNarration()
    render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    await userEvent.click(screen.getByRole('button', { name: 'Previous sentence' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next sentence' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stop reading' }))

    expect(narration.previousSentence).toHaveBeenCalledTimes(1)
    expect(narration.play).toHaveBeenCalledTimes(1)
    expect(narration.nextSentence).toHaveBeenCalledTimes(1)
    expect(narration.stop).toHaveBeenCalledTimes(1)
  })

  it('flips the play/pause accessible name and aria-pressed with the state', async () => {
    const narration = makeNarration({ state: 'playing' })
    const { rerender } = render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    const pauseButton = screen.getByRole('button', { name: 'Pause' })
    expect(pauseButton).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(pauseButton)
    expect(narration.pause).toHaveBeenCalledTimes(1)
    expect(narration.play).not.toHaveBeenCalled()

    const paused = makeNarration({ state: 'paused' })
    rerender(<NarrationPlayer narration={paused} pageLabel="page 3" />)

    const playButton = screen.getByRole('button', { name: 'Play' })
    expect(playButton).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(playButton)
    // `play()` with no argument resumes a live paused session in place; the player does no
    // resume/restart branching of its own.
    expect(paused.play).toHaveBeenCalledWith()
  })

  it('renders an inert, explained state when narration is unavailable', () => {
    const narration = makeNarration({ state: 'unavailable', voiceStatus: 'unavailable' })
    render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    expect(screen.getByText("Read-aloud isn't available in this browser.")).toBeInTheDocument()
    expect(screen.queryByTestId('narration-settings')).not.toBeInTheDocument()

    for (const name of ['Previous sentence', 'Play', 'Next sentence', 'Stop reading']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-disabled', 'true')
      // A disabled control must be inert, not throwing — this is the honest-disabled path.
      expect(() => fireEvent.click(button)).not.toThrow()
    }

    expect(narration.play).not.toHaveBeenCalled()
    expect(narration.stop).not.toHaveBeenCalled()
  })

  it('disables the transport while voices are still loading, without the unavailable copy', () => {
    const narration = makeNarration({ voiceStatus: 'loading' })
    render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByTestId('narration-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('narration-unavailable')).not.toBeInTheDocument()
  })

  it('lists the available voices and persists a choice through setPrefs', async () => {
    const narration = makeNarration({ voices: VOICES })
    render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    const select = screen.getByLabelText('Voice')
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Bruno' })).toBeInTheDocument()

    await userEvent.selectOptions(select, 'voice-b')
    expect(narration.setPrefs).toHaveBeenCalledWith({ voiceURI: 'voice-b' })

    // "Device default" hands the choice back to the hook's default-voice ladder.
    await userEvent.selectOptions(select, '')
    expect(narration.setPrefs).toHaveBeenCalledWith({ voiceURI: null })
  })

  it('offers exactly RATE_OPTIONS as speeds and persists the choice through setPrefs', async () => {
    const narration = makeNarration()
    render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    const select = screen.getByLabelText<HTMLSelectElement>('Speed')
    expect([...select.options].map((option) => option.value)).toEqual(
      RATE_OPTIONS.map((rate) => String(rate)),
    )

    await userEvent.selectOptions(select, '1.5')
    expect(narration.setPrefs).toHaveBeenCalledWith({ rate: 1.5 })
  })

  it('reflects and toggles auto-advance', async () => {
    const narration = makeNarration()
    const { rerender } = render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    const checkbox = screen.getByLabelText('Turn pages automatically')
    expect(checkbox).toBeChecked()

    await userEvent.click(checkbox)
    expect(narration.setPrefs).toHaveBeenCalledWith({ autoAdvance: false })

    const off = makeNarration({ prefs: { ...DEFAULT_PREFS, autoAdvance: false } })
    rerender(<NarrationPlayer narration={off} pageLabel="page 3" />)
    expect(screen.getByLabelText('Turn pages automatically')).not.toBeChecked()
  })

  it('announces terse transitions in a visually-hidden polite status region', () => {
    const narration = makeNarration()
    const { rerender } = render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveClass('sr-only')
    // Nothing has happened yet, so nothing is announced.
    expect(status).toHaveTextContent('')

    rerender(<NarrationPlayer narration={makeNarration({ state: 'playing' })} pageLabel="page 3" />)
    expect(screen.getByRole('status')).toHaveTextContent('Reading page 3')

    rerender(<NarrationPlayer narration={makeNarration({ state: 'paused' })} pageLabel="page 3" />)
    expect(screen.getByRole('status')).toHaveTextContent('Paused')

    rerender(<NarrationPlayer narration={makeNarration({ state: 'idle' })} pageLabel="page 3" />)
    expect(screen.getByRole('status')).toHaveTextContent('Finished')
  })

  it('surfaces the tap-to-continue hint with play still enabled when a gesture is needed', () => {
    const narration = makeNarration({ state: 'paused', needsGesture: true })
    render(<NarrationPlayer narration={narration} pageLabel="page 3" />)

    expect(screen.getByTestId('narration-hint')).toHaveTextContent('Tap play to continue.')
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Tap play to continue.')
  })

  it('stays in normal flow — UpdateToast is the app’s only bottom-fixed surface', () => {
    render(<NarrationPlayer narration={makeNarration()} pageLabel="page 3" className="mx-auto" />)

    const root = screen.getByTestId('narration-player')
    expect(root.className).not.toMatch(/(^|:|\s)fixed(\s|$)/)
    expect(root.className).not.toMatch(/(^|:|\s)sticky(\s|$)/)
    expect(root.className).not.toMatch(/(^|:|\s)absolute(\s|$)/)
    expect(root).toHaveClass('mx-auto')
  })
})
