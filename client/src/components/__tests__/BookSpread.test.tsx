import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BookSpread from '../BookSpread'
import type { BookWithPages } from '../../types'
import { AUTO_ADVANCE_DELAY_MS } from '../../hooks/useNarration'
import {
  installFakeSpeech,
  uninstallFakeSpeech,
  type FakeSpeechControl,
} from '../../test/fakeSpeech'

const mockBook: BookWithPages = {
  id: 'book-1',
  title: 'The Brave Little Fox',
  author: 'AI Author',
  description: 'A story about a courageous fox.',
  theme: 'adventure',
  age_range: '3-5',
  cover_emoji: '🦊',
  cover_color: '#ff6600',
  cover_url: null,
  price: 12.99,
  is_featured: false,
  is_user_created: true,
  status: 'draft',
  version: 1,
  characters: [],
  characters_json: null,
  style_descriptor: null,
  style_reference_url: null,
  image_provider: null,
  image_model: null,
  created_by: 'user-1',
  created_at: new Date().toISOString(),
  deleted_at: null,
  pages: [
    {
      id: 1,
      book_id: 'book-1',
      page_number: 1,
      text: 'Page 1 text',
      illustration_description: 'desc 1',
      illustration_url: null,
    },
    {
      id: 2,
      book_id: 'book-1',
      page_number: 2,
      text: 'Page 2 text',
      illustration_description: 'desc 2',
      illustration_url: null,
    },
  ],
}

type BookSpreadProps = React.ComponentProps<typeof BookSpread>

function renderSpread(props: Partial<BookSpreadProps> = {}) {
  return render(
    <BookSpread
      book={mockBook}
      isOwner
      isDraft
      illustrating={false}
      onIllustratePage={vi.fn()}
      onRevise={vi.fn()}
      revising={false}
      theater={false}
      onToggleTheater={vi.fn()}
      {...props}
    />
  )
}

describe('BookSpread — theater toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the toggle with aria-label "Expand to theater mode" and aria-pressed="false" when theater is off', () => {
    renderSpread({ theater: false })
    const toggle = screen.getByRole('button', { name: /expand to theater mode/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders the toggle with aria-label "Exit theater mode" and aria-pressed="true" when theater is on', () => {
    renderSpread({ theater: true })
    const toggle = screen.getByRole('button', { name: /exit theater mode/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('calls onToggleTheater when the toggle is clicked', () => {
    const onToggleTheater = vi.fn()
    renderSpread({ theater: false, onToggleTheater })
    fireEvent.click(screen.getByRole('button', { name: /expand to theater mode/i }))
    expect(onToggleTheater).toHaveBeenCalledTimes(1)
  })

  it('applies the wide frame width class when theater is on', () => {
    renderSpread({ theater: true })
    const frame = screen.getByTestId('book-spread-frame')
    expect(frame.className).toContain('max-w-[min(90vw,1600px)]')
  })

  it('applies the narrow frame width class when theater is off', () => {
    renderSpread({ theater: false })
    const frame = screen.getByTestId('book-spread-frame')
    expect(frame.className).toContain('max-w-[900px]')
  })

  it('hides the toggle on viewports below md via hidden md:inline-flex', () => {
    renderSpread({ theater: false })
    const toggle = screen.getByRole('button', { name: /expand to theater mode/i })
    expect(toggle.className).toContain('hidden')
    expect(toggle.className).toContain('md:inline-flex')
  })

  it('includes dark-mode classes on the toggle button', () => {
    renderSpread({ theater: false })
    const toggle = screen.getByRole('button', { name: /expand to theater mode/i })
    expect(toggle.className).toContain('dark:')
  })
})

/**
 * Forces `window.matchMedia` to report a match for the given query and a miss for every
 * other one, so a component driven by `useMediaQuery` takes its narrow branch.
 *
 * The jsdom stub in client/src/test/setup.ts always answers `matches: false`, which is
 * how every other test in this file gets the desktop layout without asking for it.
 */
function matchOnly(query: string): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q === query,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

const NARROW_QUERY = '(max-width: 767px)'

describe('BookSpread — single-page mode below md', () => {
  const realMatchMedia = window.matchMedia

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: realMatchMedia })
  })

  it('renders two page panels at desktop width', () => {
    renderSpread()
    expect(screen.getAllByTestId('book-page-panel')).toHaveLength(2)
  })

  it('renders exactly one page panel below md', () => {
    matchOnly(NARROW_QUERY)
    renderSpread()
    expect(screen.getAllByTestId('book-page-panel')).toHaveLength(1)
  })

  it('advances one page per tap of Next below md, not two', async () => {
    matchOnly(NARROW_QUERY)
    renderSpread()

    // The reader opens on the cover.
    expect(screen.getByText('Cover')).toBeInTheDocument()

    const next = screen.getByRole('button', { name: 'Next spread' })
    fireEvent.click(next)
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
    expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next spread' }))
    await waitFor(() => expect(screen.getByText('Page 2 of 2')).toBeInTheDocument())
    expect(screen.getByText('Page 2 text')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous spread' }))
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
  })

  it('renders exactly one Next/Previous control below md — never both layouts at once', () => {
    matchOnly(NARROW_QUERY)
    renderSpread()
    expect(screen.getAllByRole('button', { name: 'Next spread' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Previous spread' })).toHaveLength(1)
  })

  it('drops the pl-14 / pr-14 chevron gutter from the single panel', () => {
    matchOnly(NARROW_QUERY)
    renderSpread()
    const panel = screen.getByTestId('book-page-panel')
    expect(panel.className).not.toContain('pl-14')
    expect(panel.className).not.toContain('pr-14')
    expect(panel.className).toContain('dark:bg-gray-800')
  })
})

/**
 * Narration wiring. The state machine itself is covered by useNarration.test.tsx and the
 * control bar by NarrationPlayer.test.tsx; what is under test here is only the three
 * connections BookSpread owns — the highlight, the auto-advance page turn, and the text
 * each spread hands to the hook.
 */

/** Two sentences per page, so "the highlight is on sentence one" is a real assertion. */
const narrationBook: BookWithPages = {
  ...mockBook,
  pages: [
    { ...(mockBook.pages[0] as BookWithPages['pages'][number]), text: 'Luna woke up. The garden was glowing.' },
    { ...(mockBook.pages[1] as BookWithPages['pages'][number]), text: 'The stars were dancing. Luna laughed.' },
  ],
}

/** The fake's default: one utterance takes this long under fake timers. */
const CHUNK_MS = 100

/**
 * Advances fake timers inside `act`, then drains. The fake starts the next utterance from
 * the previous one's `end` handler, and vitest's clock only picks up a zero-delay timer
 * scheduled *during* a tick on a subsequent advance — without draining, a page stalls one
 * utterance short. Mirrors the helper in useNarration.test.tsx.
 */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
    for (let step = 0; step < 4; step += 1) vi.advanceTimersByTime(1)
  })
}

/** The page-turn animation before `spreadIndex` actually moves. */
const FLIP_MS = 250

function clickNextSpread(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Next spread' }))
  tick(FLIP_MS)
}

/** The sentence spans of the paragraph currently being narrated, in document order. */
function sentenceSpans(): HTMLElement[] {
  const paragraph = screen.getByTestId('narration-highlight').closest('p')
  if (!paragraph) throw new Error('no narrated paragraph in the document')
  return Array.from(paragraph.querySelectorAll<HTMLElement>(':scope > span'))
}

describe('BookSpread — narration', () => {
  const realMatchMedia = window.matchMedia
  let control: FakeSpeechControl

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.removeItem('storybook-narration')
    control = installFakeSpeech()
  })

  afterEach(() => {
    uninstallFakeSpeech()
    vi.useRealTimers()
    localStorage.removeItem('storybook-narration')
    Object.defineProperty(window, 'matchMedia', { writable: true, value: realMatchMedia })
  })

  // One DOM shape at every breakpoint. Two copies would give two nodes the same
  // accessible name, which is the fence mobile/reader.spec.ts established for the chevrons.
  it('mounts exactly one narration player at desktop width', () => {
    renderSpread({ book: narrationBook })
    clickNextSpread()
    expect(screen.getAllByTestId('narration-player')).toHaveLength(1)
  })

  it('mounts exactly one narration player below md', () => {
    matchOnly(NARROW_QUERY)
    renderSpread({ book: narrationBook })
    clickNextSpread()
    expect(screen.getAllByTestId('narration-player')).toHaveLength(1)
  })

  // The regression fence for the untouched case: nothing about the page changes until
  // something is actually being spoken.
  it('renders the page text unchanged while narration is idle', () => {
    renderSpread({ book: narrationBook })
    clickNextSpread()

    expect(screen.getByText('Luna woke up. The garden was glowing.')).toBeInTheDocument()
    expect(screen.queryByTestId('narration-highlight')).not.toBeInTheDocument()
  })

  it('highlights exactly one sentence — the one being spoken — on play', () => {
    renderSpread({ book: narrationBook })
    clickNextSpread()

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    // Position is set optimistically at speak() time, so the highlight lands on the press.
    const highlights = screen.getAllByTestId('narration-highlight')
    expect(highlights).toHaveLength(1)
    expect(highlights[0]).toHaveTextContent('Luna woke up.')
    expect(highlights[0]?.tagName).toBe('SPAN')
    // <mark> would make VoiceOver announce "highlighted" mid-sentence.
    expect(highlights[0]?.className).toContain('dark:bg-amber-500/30')

    tick(CHUNK_MS)
    expect(screen.getByTestId('narration-highlight')).toHaveTextContent('The garden was glowing.')
  })

  it('starts playback from a sentence the reader taps', () => {
    renderSpread({ book: narrationBook })
    clickNextSpread()

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    const spans = sentenceSpans()
    expect(spans).toHaveLength(2)

    const spokenBefore = control.spoken().length
    fireEvent.click(spans[1] as HTMLElement)

    expect(screen.getByTestId('narration-highlight')).toHaveTextContent('The garden was glowing.')
    // Re-queued from the tapped sentence, not from the top of the page.
    expect(control.spoken().slice(spokenBefore)).toEqual(['The garden was glowing.'])
  })

  /**
   * The word-level enhancement. It self-activates off real word `boundary` events, so the
   * pair below is the whole contract: a word span when the engine reports words, and the
   * untouched sentence highlight when it does not.
   */
  it('wraps the spoken word inside the active sentence when the engine reports words', () => {
    installFakeSpeech({ emitWordBoundary: true })
    renderSpread({ book: narrationBook })
    clickNextSpread()

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    tick(1)

    const sentence = screen.getByTestId('narration-highlight')
    const word = screen.getByTestId('narration-word')
    expect(sentence).toContainElement(word)
    expect(word.tagName).toBe('SPAN')
    expect(word).toHaveTextContent('Luna')
    expect(word.className).toContain('dark:bg-amber-400/40')
    // Narrowing the highlight must not lose a character of the sentence.
    expect(sentence).toHaveTextContent('Luna woke up.')
  })

  // The degradation path — Safari and Android Chrome — asserted rather than assumed.
  it('renders the sentence highlight alone when no word boundaries arrive', () => {
    renderSpread({ book: narrationBook })
    clickNextSpread()

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    tick(CHUNK_MS)

    expect(screen.getByTestId('narration-highlight')).toHaveTextContent('The garden was glowing.')
    expect(screen.queryByTestId('narration-word')).not.toBeInTheDocument()
  })

  // Open question 1, resolved: one Play press reads the whole book, starting with the cover.
  it('reads the title and author on the cover spread', () => {
    renderSpread({ book: narrationBook })

    expect(screen.getByTestId('spread-position')).toHaveTextContent('Cover')
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(control.spoken().join(' ')).toBe('The Brave Little Fox. By AI Author.')
  })

  it('turns the page itself when a page finishes and auto-advance is on', () => {
    renderSpread({ book: narrationBook })
    clickNextSpread()
    expect(screen.getByTestId('spread-position')).toHaveTextContent('Page 1 of 2')

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    tick(CHUNK_MS * 2 + AUTO_ADVANCE_DELAY_MS + FLIP_MS)

    expect(screen.getByTestId('spread-position')).toHaveTextContent('Page 2 of 2')
    // Re-armed on the new page rather than carrying the old page's audio across.
    expect(control.spoken().slice(-2)).toEqual(['The stars were dancing.', 'Luna laughed.'])
  })

  it('reads "The End." on the end spread without asking for another page', () => {
    renderSpread({ book: narrationBook })
    clickNextSpread()
    clickNextSpread()
    clickNextSpread()
    expect(screen.getByTestId('spread-position')).toHaveTextContent('End')

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(control.spoken()).toEqual(['The End.'])

    tick(CHUNK_MS + AUTO_ADVANCE_DELAY_MS + FLIP_MS)

    // hasNext is false on the last spread, so playback stops rather than requesting a turn.
    expect(screen.getByTestId('spread-position')).toHaveTextContent('End')
    expect(control.spoken()).toEqual(['The End.'])
  })
})
