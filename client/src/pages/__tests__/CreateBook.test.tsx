import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PER_IMAGE_COST_USD, portraitStepCostNote } from '../../lib/cost'
import { AUTH_EXPIRED_EVENT } from '../../lib/authFetch'
import { AGE_RANGES } from '../../lib/ageRanges'
import { CREATE_DRAFT_KEY } from '../../lib/createDraft'
import CreateBook, {
  quickModeCostLabel,
  coverModeCostLabel,
  fullModeCostLabel,
  laterClickCostNote,
} from '../CreateBook'

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'test@example.com', name: 'Test User', token: 'test-token', role: 'user' as const },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

// The wizard persists a draft to sessionStorage; start every test from a clean slate.
beforeEach(() => sessionStorage.clear())

describe('CreateBook — cost copy', () => {
  it('quick mode reports zero image AI cost', () => {
    expect(quickModeCostLabel()).toBe('$0 — no image AI calls')
  })

  it('cover mode reports a single image at the per-image cost', () => {
    expect(coverModeCostLabel()).toBe(`~$${PER_IMAGE_COST_USD.toFixed(2)} — 1 image AI call`)
  })

  it('full mode cost scales with pageCount (cover + every page) from the per-image constant', () => {
    // 5 pages -> 6 images (cover + 5 pages) -> 6 * PER_IMAGE_COST_USD
    const fiveImages = (5 + 1) * PER_IMAGE_COST_USD
    expect(fullModeCostLabel(5)).toBe(`~$${fiveImages.toFixed(2)} — 6 image AI calls`)

    // 10 pages -> 11 images
    const elevenImages = (10 + 1) * PER_IMAGE_COST_USD
    expect(fullModeCostLabel(10)).toBe(`~$${elevenImages.toFixed(2)} — 11 image AI calls`)

    // The displayed figure is derived from the constant, not a hard-coded literal:
    // bumping pageCount by 1 adds exactly one PER_IMAGE_COST_USD.
    const a = parseFloat(fullModeCostLabel(7).match(/\$([\d.]+)/)![1]!)
    const b = parseFloat(fullModeCostLabel(8).match(/\$([\d.]+)/)![1]!)
    expect(b - a).toBeCloseTo(PER_IMAGE_COST_USD, 5)
  })

  it('later-click note quotes the per-image constant', () => {
    expect(laterClickCostNote()).toContain(`~$${PER_IMAGE_COST_USD.toFixed(2)}`)
  })

  it('portrait-step note scales with required-character count from the per-image constant', () => {
    // 1 required character -> 1 * PER_IMAGE_COST_USD; 3 required -> 3 * ...
    expect(portraitStepCostNote(1)).toContain(`~$${(1 * PER_IMAGE_COST_USD).toFixed(2)} to generate`)
    expect(portraitStepCostNote(3)).toContain(`~$${(3 * PER_IMAGE_COST_USD).toFixed(2)} to generate`)

    // The total figure is derived from the constant, not a literal: bumping the
    // required count by 1 adds exactly one PER_IMAGE_COST_USD.
    const a = parseFloat(portraitStepCostNote(2).match(/~\$([\d.]+) to generate/)![1]!)
    const b = parseFloat(portraitStepCostNote(3).match(/~\$([\d.]+) to generate/)![1]!)
    expect(b - a).toBeCloseTo(PER_IMAGE_COST_USD, 5)

    // Regenerate price is the single per-image constant, not a second figure.
    expect(portraitStepCostNote(2)).toContain(`Each regenerate is ~$${PER_IMAGE_COST_USD.toFixed(2)}`)
  })
})

// Step 2 (Cast & Age) is where the age picker lives. Getting there is: pick a
// theme on step 1, hit Next.
const renderAtStepTwo = (): void => {
  render(
    <MemoryRouter>
      <CreateBook />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Adventure/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}

// The age buttons are the only ones on this step labelled "Ages <range>".
const ageButtons = (): HTMLElement[] => screen.getAllByRole('button', { name: /^Ages / })

describe('CreateBook — age range picker', () => {
  it('renders exactly one button per canonical AGE_RANGES entry', () => {
    renderAtStepTwo()

    // Iterating the imported constant is the point: re-typing the literals here
    // would let the client and server vocabularies diverge without failing a
    // test, which is the drift this exists to catch (#172).
    expect(ageButtons()).toHaveLength(AGE_RANGES.length)
    for (const range of AGE_RANGES) {
      expect(screen.getByRole('button', { name: `Ages ${range}` })).toBeInTheDocument()
    }
  })

  it('renders no button for the retired 2-4 / 6-10 vocabulary', () => {
    renderAtStepTwo()

    for (const retired of ['2-4', '6-10']) {
      expect(screen.queryByRole('button', { name: `Ages ${retired}` })).not.toBeInTheDocument()
      expect(AGE_RANGES).not.toContain(retired)
    }
  })

  it('selects an age on click and lets step 2 advance', () => {
    renderAtStepTwo()

    fireEvent.change(screen.getByPlaceholderText('Name (e.g., Luna)'), {
      target: { value: 'Luna' },
    })

    // A named primary character alone is not enough — an age range is required
    // to leave step 2.
    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).toBeDisabled()

    const chosen = AGE_RANGES[0]!
    const chosenButton = screen.getByRole('button', { name: `Ages ${chosen}` })
    fireEvent.click(chosenButton)

    // Selected state is the purple fill; unselected chips keep the gray surface.
    expect(chosenButton.className).toContain('bg-purple-500')
    expect(
      screen.getByRole('button', { name: `Ages ${AGE_RANGES[1]!}` }).className,
    ).not.toContain('bg-purple-500')

    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(screen.getByText('Any Special Requests?')).toBeInTheDocument()
  })
})

describe('CreateBook — expired session (401)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches the auth-expired event when generate returns 401 and does not throw', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Session expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const onExpired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    try {
      renderAtStepTwo()
      fireEvent.change(screen.getByPlaceholderText('Name (e.g., Luna)'), { target: { value: 'Luna' } })
      fireEvent.click(screen.getByRole('button', { name: `Ages ${AGE_RANGES[0]!}` }))
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      fireEvent.click(screen.getByRole('button', { name: /Generate My Story/ }))

      await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1))
      expect(fetchSpy).toHaveBeenCalledWith('/api/generate', expect.objectContaining({ method: 'POST' }))
      expect((onExpired.mock.calls[0]![0] as CustomEvent).detail).toEqual({ token: 'test-token' })
    } finally {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
    }
  })
})

describe('CreateBook — draft kept across the sign-in bounce', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    v: 1,
    step: 2,
    theme: 'adventure',
    customTheme: '',
    stylePreset: 'storybook',
    cast: [{ role: 'primary', name: 'Mira', descriptor: '' }],
    ageRange: AGE_RANGES[1]!,
    additionalDetails: '',
    previewMode: 'quick',
    pageCount: 5,
    styleReferenceUrl: '',
    customStyleDescriptor: '',
    ...over,
  })

  beforeEach(() => sessionStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('writes the filled-in fields to sessionStorage', () => {
    renderAtStepTwo()
    fireEvent.change(screen.getByPlaceholderText('Name (e.g., Luna)'), { target: { value: 'Luna' } })
    fireEvent.click(screen.getByRole('button', { name: `Ages ${AGE_RANGES[0]!}` }))
    const saved = JSON.parse(sessionStorage.getItem(CREATE_DRAFT_KEY) ?? 'null')
    expect(saved).toMatchObject({ v: 1, step: 2, theme: 'adventure', ageRange: AGE_RANGES[0]! })
    expect(saved.cast[0]).toMatchObject({ role: 'primary', name: 'Luna' })
  })

  it('restores step, theme, character name and age range from a stored draft', () => {
    sessionStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(stored()))
    render(<MemoryRouter><CreateBook /></MemoryRouter>)
    expect(screen.getByPlaceholderText('Name (e.g., Luna)')).toHaveValue('Mira')
    expect(screen.getByRole('button', { name: `Ages ${AGE_RANGES[1]!}` }).className).not.toBe(
      screen.getByRole('button', { name: `Ages ${AGE_RANGES[0]!}` }).className,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: /Adventure/ })).toBeInTheDocument()
  })

  it('ignores a draft whose cast has no primary character', () => {
    sessionStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(stored({ cast: [{ role: 'supporting', name: 'Mira' }] })))
    render(<MemoryRouter><CreateBook /></MemoryRouter>)
    expect(screen.queryByPlaceholderText('Name (e.g., Luna)')).toBeNull()
    expect(screen.getByRole('button', { name: /Adventure/ })).toBeInTheDocument()
  })

  it('clears the draft after a successful generate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'book-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    renderAtStepTwo()
    fireEvent.change(screen.getByPlaceholderText('Name (e.g., Luna)'), { target: { value: 'Luna' } })
    fireEvent.click(screen.getByRole('button', { name: `Ages ${AGE_RANGES[0]!}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(sessionStorage.getItem(CREATE_DRAFT_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Generate My Story/ }))
    await waitFor(() => expect(sessionStorage.getItem(CREATE_DRAFT_KEY)).toBeNull())
  })
})
