import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BookSpread from '../BookSpread'
import type { BookWithPages, IllustrationVersion } from '../../types'
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
  font_family: 'fredoka',
  text_size: 'standard',
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

/**
 * Orphaned-illustration recovery (#95 item 2).
 *
 * A version restore nulls `illustration_url` on every page while the files and the
 * IllustrationVersion rows survive, so a page can have real art and no pointer to it.
 * The History strip lives inside the has-an-image branch, so before this the only path
 * the placeholder offered was "Generate illustration (~$0.04)" — paying again for a PNG
 * already on disk. The parent passes the surviving history down; this block fences the
 * affordance that spends it, and the gates that must keep it out of everyone else's way.
 */
const orphanedHistory: IllustrationVersion[] = [
  {
    url: '/illustrations/book-1/page-1.png',
    version: 1,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    feedback: null,
  },
  {
    url: '/illustrations/book-1/page-1-v2.png',
    version: 2,
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    feedback: 'warmer colors',
  },
]

/** The reader opens on the cover; page 1 is one turn in. */
async function turnToPageOne(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Next spread' }))
  await waitFor(() =>
    expect(screen.getByTestId('spread-position')).toHaveTextContent('Page 1 of 2')
  )
}

describe('BookSpread — orphaned illustration recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers every surviving version of a page that has no current image', async () => {
    renderSpread({
      orphanedVersions: { 1: orphanedHistory },
      onRevertIllustration: vi.fn(),
    })
    await turnToPageOne()

    expect(screen.getByTestId('orphan-restore')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Restore page 1 illustration version 1' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Restore page 1 illustration version 2' })
    ).toBeInTheDocument()
    // The re-roll feedback the version was generated with, so v2 is identifiable.
    expect(screen.getByText(/warmer colors/)).toBeInTheDocument()
  })

  it('re-attaches through the free revert callback, never the paid generate path', async () => {
    const onRevertIllustration = vi.fn().mockResolvedValue(undefined)
    const onIllustratePage = vi.fn().mockResolvedValue(undefined)
    renderSpread({
      orphanedVersions: { 1: orphanedHistory },
      onRevertIllustration,
      onIllustratePage,
    })
    await turnToPageOne()

    fireEvent.click(screen.getByRole('button', { name: 'Restore page 1 illustration version 2' }))

    expect(onRevertIllustration).toHaveBeenCalledTimes(1)
    expect(onRevertIllustration).toHaveBeenCalledWith(1, '/illustrations/book-1/page-1-v2.png')
    expect(onIllustratePage).not.toHaveBeenCalled()
  })

  it('says the restore is free and quotes no price', async () => {
    renderSpread({
      orphanedVersions: { 1: orphanedHistory },
      onRevertIllustration: vi.fn(),
    })
    await turnToPageOne()

    const panel = screen.getByTestId('orphan-restore')
    expect(panel.textContent).toMatch(/free/i)
    expect(panel.textContent).not.toMatch(/\$/)
  })

  it('carries a dark: partner on every coloured surface in the panel', async () => {
    renderSpread({
      orphanedVersions: { 1: orphanedHistory },
      onRevertIllustration: vi.fn(),
    })
    await turnToPageOne()

    const panel = screen.getByTestId('orphan-restore')
    expect(panel.className).toContain('dark:bg-purple-900/20')
    expect(panel.className).toContain('dark:border-purple-800')
    const thumb = screen.getByRole('button', { name: 'Restore page 1 illustration version 1' })
    expect(thumb.className).toContain('dark:border-gray-600')
    expect(thumb.className).toContain('dark:hover:border-purple-500')
  })

  // The page the parent found nothing for must look exactly like it did before —
  // an empty history affordance is worse than none.
  it('renders the placeholder untouched when the page has no surviving history', async () => {
    renderSpread({ onRevertIllustration: vi.fn() })
    await turnToPageOne()

    expect(screen.queryByTestId('orphan-restore')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Restore page/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate illustration/i })).toBeInTheDocument()
  })

  it('renders nothing for a non-owner even when history survives', async () => {
    renderSpread({
      isOwner: false,
      orphanedVersions: { 1: orphanedHistory },
      onRevertIllustration: vi.fn(),
    })
    await turnToPageOne()

    expect(screen.queryByTestId('orphan-restore')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Restore page/ })).not.toBeInTheDocument()
  })

  it('renders nothing on a published book even when history survives', async () => {
    renderSpread({
      isDraft: false,
      book: { ...mockBook, status: 'published' },
      orphanedVersions: { 1: orphanedHistory },
      onRevertIllustration: vi.fn(),
    })
    await turnToPageOne()

    expect(screen.queryByTestId('orphan-restore')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Restore page/ })).not.toBeInTheDocument()
  })

  it('scopes the offer to the page it belongs to', async () => {
    renderSpread({
      orphanedVersions: { 1: orphanedHistory },
      onRevertIllustration: vi.fn(),
    })
    await turnToPageOne()
    expect(screen.getByTestId('orphan-restore')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next spread' }))
    await waitFor(() =>
      expect(screen.getByTestId('spread-position')).toHaveTextContent('Page 2 of 2')
    )
    expect(screen.queryByTestId('orphan-restore')).not.toBeInTheDocument()
  })
})

/**
 * The re-roll style hint (mitigation B, Task 9). It sits with the re-roll controls and is
 * gated on exactly the same three conditions they are — owner, draft, and a page that
 * already has art — so the assertions below pin each condition separately rather than
 * only the happy path.
 */
const illustratedBook: BookWithPages = {
  ...mockBook,
  pages: mockBook.pages.map(p => ({ ...p, illustration_url: `/illustrations/book-1/page-${p.page_number}.png` })),
}

/** The reader opens on the cover; the hint lives on a story page. */
async function goToFirstStoryPage(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Next spread' }))
  await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
}

describe('BookSpread — re-roll style hint', () => {
  it('renders the hint for an owner on a draft book with an illustrated page', async () => {
    renderSpread({ book: illustratedBook, isOwner: true, isDraft: true })
    await goToFirstStoryPage()

    expect(screen.getByText('What to change on re-roll')).toBeInTheDocument()
    expect(screen.getByText(/re-rolls match this book/i)).toBeInTheDocument()
  })

  it('pairs every colour class on the hint with a dark-mode partner', async () => {
    renderSpread({ book: illustratedBook, isOwner: true, isDraft: true })
    await goToFirstStoryPage()

    const hint = screen.getByText(/re-rolls match this book/i)
    expect(hint.className).toContain('text-gray-500')
    expect(hint.className).toContain('dark:text-gray-400')
  })

  it('does not render the hint for a non-owner', async () => {
    renderSpread({ book: illustratedBook, isOwner: false, isDraft: true })
    await goToFirstStoryPage()

    expect(screen.queryByText('What to change on re-roll')).not.toBeInTheDocument()
    expect(screen.queryByText(/re-rolls match this book/i)).not.toBeInTheDocument()
  })

  it('does not render the hint on a published book', async () => {
    renderSpread({
      book: { ...illustratedBook, status: 'published' },
      isOwner: true,
      isDraft: false,
    })
    await goToFirstStoryPage()

    expect(screen.queryByText('What to change on re-roll')).not.toBeInTheDocument()
    expect(screen.queryByText(/re-rolls match this book/i)).not.toBeInTheDocument()
  })

  it('does not render the hint on a page that has no illustration yet', async () => {
    renderSpread({ book: mockBook, isOwner: true, isDraft: true })
    await goToFirstStoryPage()

    expect(screen.queryByText(/re-rolls match this book/i)).not.toBeInTheDocument()
  })

  /**
   * Reviewer finding 1 on #154: the reader-view row got a permanent e2e fence
   * (`expectTapTargets` in `e2e/tests/mobile/reader-view.spec.ts`), and this row — the
   * same fix on the same money-path argument — got nothing. No mobile e2e spec covers
   * it: `illustration-actions.spec.ts` measures "Illustrate All" / "Skip portraits" /
   * "Download PDF", and the only other e2e mention of `Redo` runs desktop-only and
   * asserts visibility, not size.
   *
   * That inverts the usual risk ordering. The volunteered half of a change is the half
   * most likely to be undone by a later refactor, because nobody remembers why it was
   * there. A class pin is the cheap durable option, with in-repo precedent at
   * `ErrorToastHost.test.tsx` ("gives the dismiss control a 44px tap target").
   *
   * This pins the class, not the rendered height — jsdom computes no layout, so it
   * cannot measure 44px. It catches the realistic regression (someone swaps `min-h-11`
   * back for `py-1.5` while tidying) and does not pretend to be the measurement the e2e
   * helper does. A mobile e2e spec for this panel would be the fuller answer; filed
   * separately rather than widening this PR.
   */
  it('holds both re-roll controls at the 44px money-path tap floor', async () => {
    // `History` renders only when `onShowVersions` is supplied; renderSpread's defaults
    // omit it, so without this the row is one button and the assertion below is half a test.
    renderSpread({ book: illustratedBook, isOwner: true, isDraft: true, onShowVersions: vi.fn() })
    await goToFirstStoryPage()

    // `Redo` spends ~$0.04 on a real image generation and says so in its own label, so
    // it is PRIMARY_TAP_MIN (44px, Apple HIG), not the 24px navbar-chrome floor.
    const redo = screen.getByRole('button', { name: /Redo/ })
    expect(redo.className).toContain('min-h-11')

    // `History` is free, but it shares the row and matches — a 36px control beside a
    // 44px one is the mis-tap the floor exists to prevent.
    const history = screen.getByRole('button', { name: /^History$/ })
    expect(history.className).toContain('min-h-11')
  })

  it('keeps the re-roll row from relying on vertical padding for its height', async () => {
    // Guards the guard. `min-h-11` and `py-1.5` are not mutually exclusive in CSS, so a
    // future edit could re-add the padding, pass the assertion above, and quietly change
    // the row's visual weight back. The height must come from the min-height alone.
    renderSpread({ book: illustratedBook, isOwner: true, isDraft: true, onShowVersions: vi.fn() })
    await goToFirstStoryPage()

    for (const name of [/Redo/, /^History$/]) {
      expect(screen.getByRole('button', { name }).className).not.toMatch(/\bpy-\d/)
    }
  })
})
