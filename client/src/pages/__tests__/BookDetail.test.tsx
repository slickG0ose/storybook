import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import BookDetail from '../BookDetail'
import type { BookWithPages, BookVersion, IllustrationVersion } from '../../types'
import type { CartContextValue } from '../../context/CartContext'

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  token: 'test-token',
  role: 'user' as const,
}

const baseBook: BookWithPages = {
  id: 'book-1',
  title: 'Test Adventure',
  author: 'AI Author',
  description: 'A test adventure story.',
  theme: 'adventure',
  age_range: '3-5',
  cover_emoji: '🦊',
  cover_color: '#ff6600',
  cover_url: null,
  price: 12.99,
  is_featured: false,
  is_user_created: true,
  status: 'draft',
  version: 3,
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
    { id: 1, book_id: 'book-1', page_number: 1, text: 'Page 1 current', illustration_description: 'desc 1', illustration_url: null },
    { id: 2, book_id: 'book-1', page_number: 2, text: 'Page 2 current', illustration_description: 'desc 2', illustration_url: null },
  ],
}

const restoredBook: BookWithPages = {
  ...baseBook,
  version: 4,
  pages: [
    { id: 10, book_id: 'book-1', page_number: 1, text: 'Restored page 1', illustration_description: 'old desc 1', illustration_url: null },
    { id: 11, book_id: 'book-1', page_number: 2, text: 'Restored page 2', illustration_description: 'old desc 2', illustration_url: null },
  ],
}

const versionsResponse: BookVersion[] = [
  {
    id: 30,
    book_id: 'book-1',
    version: 3,
    pages_json: '[]',
    description: null,
    characters_json: null,
    created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    pages: [
      { page_number: 1, text: 'v3 page 1', illustrationDescription: 'd1' },
      { page_number: 2, text: 'v3 page 2', illustrationDescription: 'd2' },
    ],
  },
  {
    id: 20,
    book_id: 'book-1',
    version: 2,
    pages_json: '[]',
    description: null,
    characters_json: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    pages: [
      { page_number: 1, text: 'v2 page 1', illustrationDescription: 'd1' },
      { page_number: 2, text: 'v2 page 2', illustrationDescription: 'd2' },
    ],
  },
  {
    id: 10,
    book_id: 'book-1',
    version: 1,
    pages_json: '[]',
    description: null,
    characters_json: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    pages: [
      { page_number: 1, text: 'v1 page 1', illustrationDescription: 'd1' },
      { page_number: 2, text: 'v1 page 2', illustrationDescription: 'd2' },
    ],
  },
]

vi.mock('../../context/CartContext', () => ({
  useCart: (): CartContextValue => ({
    items: [],
    total: 0,
    sessionId: 'test-session',
    addToCart: vi.fn().mockResolvedValue(undefined),
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    fetchCart: vi.fn(),
    // CartContextValue gained offline/lastSyncedAt in Task 6 (offline cart).
    offline: false,
    lastSyncedAt: null,
  }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

// BookSpread imports its own deps; mock to keep the test focused on the
// version-history flow rather than the spread renderer. The mock captures the
// `theater` prop into a module-level variable so the BookDetail — theater mode
// describe block below can observe the lifted URL state without mounting the
// real spread renderer. A stub button invokes `onToggleTheater` so the round
// trip URL -> state -> child callback -> URL can be exercised.
let capturedTheaterProp: boolean | undefined
vi.mock('../../components/BookSpread', () => ({
  default: (props: { theater: boolean; onToggleTheater: () => void }) => {
    capturedTheaterProp = props.theater
    return (
      <div data-testid="book-spread">
        <button onClick={props.onToggleTheater} aria-label="theater-toggle-stub">
          theater={String(props.theater)}
        </button>
      </div>
    )
  },
}))

function renderBookDetail(opts: { search?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[`/book/book-1${opts.search ?? ''}`]}>
      <Routes>
        <Route path="/book/:id" element={<BookDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

interface FetchCall {
  url: string
  init?: RequestInit
}

// Stand-in for the PDF stream the server returns. Asserted on the way out so
// the test proves real bytes reached the download, not just that a call fired.
const FAKE_PDF_BODY = '%PDF-1.7 fake'

function setupFetchMock(opts: {
  book?: BookWithPages
  versions?: BookVersion[]
  restored?: BookWithPages
  illustrationVersions?: IllustrationVersion[]
  revised?: BookWithPages
  versionsAfterRevise?: BookVersion[]
  pdfStatus?: number
}) {
  const calls: FetchCall[] = []
  let getVersionsCount = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    const method = init?.method ?? 'GET'

    if (url === '/api/books/book-1' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.book ?? baseBook), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }
    if (url === '/api/books/book-1/versions' && method === 'GET') {
      getVersionsCount++
      const body =
        opts.versionsAfterRevise && getVersionsCount > 1
          ? opts.versionsAfterRevise
          : (opts.versions ?? versionsResponse)
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }
    if (url === '/api/books/book-1/revise' && method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.revised ?? baseBook), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }
    if (/^\/api\/books\/book-1\/versions\/\d+\/restore$/.test(url) && method === 'PUT') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.restored ?? restoredBook), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }
    if (url === '/api/books/book-1/pdf' && method === 'POST') {
      const status = opts.pdfStatus ?? 200
      if (status !== 200) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Book not found' }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      }
      // Body MUST be a plain string, not a Blob. Under jsdom, `Blob` is
      // jsdom's implementation while `Response` is Node's undici — undici
      // doesn't recognise the foreign Blob and stringifies it to the literal
      // "[object Blob]" on Node 24, and rejects outright on Node 22. Either
      // way the test is testing nothing. A string body round-trips through
      // res.blob() identically on both.
      return Promise.resolve(
        new Response(FAKE_PDF_BODY, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="test-adventure.pdf"',
          },
        })
      )
    }
    if (/^\/api\/books\/book-1\/illustrations\/\d+$/.test(url) && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.illustrationVersions ?? []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }

    return Promise.resolve(
      new Response(JSON.stringify({ error: `unmocked ${method} ${url}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })
  return { calls }
}

describe('BookDetail — Version History', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the version history section with prior versions for an owned draft', async () => {
    setupFetchMock({})
    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText('Version history')).toBeInTheDocument()
    })

    // versionsResponse has v3, v2, v1. v3 is the current draft and should be
    // hidden from the list. v2 and v1 should be the only restorable rows.
    await waitFor(() => {
      expect(screen.getByText('v2')).toBeInTheDocument()
    })
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.queryByText('v3')).not.toBeInTheDocument()

    // Two restore buttons, one per prior version.
    expect(screen.getAllByRole('button', { name: /restore version/i })).toHaveLength(2)
  })

  it('shows the empty state when only the current version exists', async () => {
    setupFetchMock({ versions: [versionsResponse[0]!] })
    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText(/no previous versions yet/i)).toBeInTheDocument()
    })
  })

  it('restores a prior version after confirmation and updates book state', async () => {
    const { calls } = setupFetchMock({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText('v1')).toBeInTheDocument()
    })

    // Click "Restore" on v1 (the oldest version).
    const restoreV1 = screen.getByRole('button', { name: /restore version 1/i })
    fireEvent.click(restoreV1)

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const confirmMessage = confirmSpy.mock.calls[0]?.[0] as string
    expect(confirmMessage).toMatch(/illustration/i)
    expect(confirmMessage).toMatch(/cleared/i)

    // Restore endpoint hit with the right URL + auth header.
    await waitFor(() => {
      const restoreCall = calls.find(c => c.url === '/api/books/book-1/versions/1/restore')
      expect(restoreCall).toBeDefined()
      expect(restoreCall?.init?.method).toBe('PUT')
      const headers = restoreCall?.init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer test-token')
    })

    // Book state should reflect the restored book — restored pages text shows
    // up (we render reader view which displays page text).
    fireEvent.click(screen.getByRole('button', { name: /reader view/i }))
    await waitFor(() => {
      expect(screen.getByText('Restored page 1')).toBeInTheDocument()
    })

    // Versions list should be re-fetched after restore (one initial GET, then
    // one after restore = at least 2 GETs to /versions).
    const versionsGets = calls.filter(c => c.url === '/api/books/book-1/versions' && (c.init?.method ?? 'GET') === 'GET')
    expect(versionsGets.length).toBeGreaterThanOrEqual(2)
  })

  it('does not call the restore endpoint when the user cancels the confirm', async () => {
    const { calls } = setupFetchMock({})
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText('v1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /restore version 1/i }))

    // No restore call should have been made.
    const restoreCall = calls.find(c => c.url.includes('/restore'))
    expect(restoreCall).toBeUndefined()
  })
})

describe('BookDetail — Illustration history active indicator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const currentUrl = '/uploads/illustrations/current.png'
  const olderUrl = '/uploads/illustrations/older.png'

  const illustratedBook: BookWithPages = {
    ...baseBook,
    pages: [
      {
        id: 1,
        book_id: 'book-1',
        page_number: 1,
        text: 'Page 1 text',
        illustration_description: 'desc 1',
        illustration_url: currentUrl,
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

  it('marks the active thumbnail with a "Current" badge and renders non-active as revert buttons', async () => {
    setupFetchMock({
      book: illustratedBook,
      illustrationVersions: [
        { url: olderUrl, version: 1, created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), feedback: null },
        { url: currentUrl, version: 2, created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), feedback: null },
      ],
    })

    renderBookDetail()

    // Switch to reader view (mocked BookSpread covers default 'spread' view).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reader view/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /reader view/i }))

    // Page 1 has an illustration; History button should be available.
    const historyBtn = await screen.findByRole('button', { name: /^history$/i })
    fireEvent.click(historyBtn)

    // After load, the carousel should render. The current thumbnail is the
    // one whose URL equals page.illustration_url -> it gets the "Current"
    // badge and is NOT a button. The older one IS a button.
    await waitFor(() => {
      expect(screen.getByText('Current')).toBeInTheDocument()
    })

    // Non-active (v1) should be a revert button. The active (v2) should not be.
    expect(screen.getByRole('button', { name: /revert to version 1/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revert to version 2/i })).not.toBeInTheDocument()
  })

  it('renders timestamp and feedback metadata for each version in the carousel', async () => {
    const olderCreated = new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString()
    const currentCreated = new Date(Date.now() - 1000 * 60 * 30).toISOString()
    const longFeedback = 'make the colors much warmer and add a bunch of extra twinkly stars in the background sky please'
    setupFetchMock({
      book: illustratedBook,
      illustrationVersions: [
        { url: olderUrl, version: 1, created_at: olderCreated, feedback: null },
        { url: currentUrl, version: 2, created_at: currentCreated, feedback: longFeedback },
      ],
    })

    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reader view/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /reader view/i }))

    const historyBtn = await screen.findByRole('button', { name: /^history$/i })
    fireEvent.click(historyBtn)

    // Version chips render for both items. Multiple "v1" / "v2" can appear in
    // the page (story-version history list also uses v{N} chips); we only need
    // to confirm the carousel chips exist.
    await waitFor(() => {
      expect(screen.getAllByText('v1').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('v2').length).toBeGreaterThan(0)

    // Relative timestamps appear (3h ago for older, 30m ago for current).
    expect(screen.getByText('3h ago')).toBeInTheDocument()
    expect(screen.getByText('30m ago')).toBeInTheDocument()

    // The feedback is truncated to ~60 chars + ellipsis, with the full text in
    // the title attribute. The null-feedback version renders nothing for that line.
    const truncated = longFeedback.slice(0, 60).trimEnd()
    const feedbackEl = screen.getByText(new RegExp(truncated.slice(0, 30)))
    expect(feedbackEl).toBeInTheDocument()
    expect(feedbackEl.getAttribute('title')).toBe(longFeedback)
    expect(feedbackEl.textContent).toContain('…')
  })
})

describe('BookDetail — Illustrate empty-response handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The illustration endpoint can return non-2xx with an empty body — when it
  // does, a bare `await res.json()` throws "Unexpected end of JSON input" and
  // the raw browser error string leaks into the UI. We should surface a
  // status-code-based message instead.
  function setupIllustrateMock(illustrateResponse: () => Response) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url === '/api/books/book-1' && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(baseBook), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      }
      if (url === '/api/books/book-1/versions' && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(versionsResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      }
      if (url === '/api/books/book-1/illustrate' && method === 'POST') {
        return Promise.resolve(illustrateResponse())
      }

      return Promise.resolve(
        new Response(JSON.stringify({ error: `unmocked ${method} ${url}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })
  }

  it('shows a status-code message instead of "Unexpected end of JSON input" when the server returns an empty 500', async () => {
    setupIllustrateMock(() => new Response('', { status: 500, statusText: 'Internal Server Error' }))
    // baseBook has 2 unillustrated pages, so "Illustrate All" triggers a
    // confirm. Auto-accept it for these tests.
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderBookDetail()

    // Wait for the book to load and the "Illustrate All" button to appear.
    const illustrateBtn = await screen.findByRole('button', { name: /illustrate all/i })
    fireEvent.click(illustrateBtn)

    // The new error message should mention the status code, not the browser's
    // raw "Unexpected end of JSON input" error.
    await waitFor(() => {
      expect(screen.getByText(/Server returned 500/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/empty response/i)).toBeInTheDocument()
    expect(screen.queryByText(/Unexpected end of JSON input/i)).not.toBeInTheDocument()
  })

  it('falls back to a non-JSON body message when the server returns garbage', async () => {
    setupIllustrateMock(() => new Response('<html>oops</html>', { status: 502, statusText: 'Bad Gateway' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderBookDetail()

    const illustrateBtn = await screen.findByRole('button', { name: /illustrate all/i })
    fireEvent.click(illustrateBtn)

    await waitFor(() => {
      expect(screen.getByText(/Server returned 502 Bad Gateway with a non-JSON body/i)).toBeInTheDocument()
    })
  })

  it('still surfaces the server error field when the body is valid JSON', async () => {
    setupIllustrateMock(() =>
      new Response(JSON.stringify({ error: 'OpenAI quota exceeded' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderBookDetail()

    const illustrateBtn = await screen.findByRole('button', { name: /illustrate all/i })
    fireEvent.click(illustrateBtn)

    await waitFor(() => {
      expect(screen.getByText(/OpenAI quota exceeded/i)).toBeInTheDocument()
    })
  })

  it('treats an empty 2xx response as an error rather than wiping book state', async () => {
    setupIllustrateMock(() => new Response('', { status: 200 }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderBookDetail()

    const illustrateBtn = await screen.findByRole('button', { name: /illustrate all/i })
    fireEvent.click(illustrateBtn)

    // Should surface an error message and the book should still render
    // (title from baseBook remains visible).
    await waitFor(() => {
      expect(screen.getByText(/Server returned 200/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Test Adventure')).toBeInTheDocument()
  })
})

describe('BookDetail — Post-revise comparison modal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const v1Book: BookWithPages = {
    ...baseBook,
    version: 1,
    pages: [
      { id: 1, book_id: 'book-1', page_number: 1, text: 'Original page 1 text', illustration_description: 'd1', illustration_url: null },
      { id: 2, book_id: 'book-1', page_number: 2, text: 'Original page 2 text', illustration_description: 'd2', illustration_url: null },
    ],
  }

  const v2Revised: BookWithPages = {
    ...baseBook,
    version: 2,
    pages: [
      { id: 1, book_id: 'book-1', page_number: 1, text: 'Revised page 1 text', illustration_description: 'd1', illustration_url: null },
      { id: 2, book_id: 'book-1', page_number: 2, text: 'Revised page 2 text', illustration_description: 'd2', illustration_url: null },
    ],
  }

  // Initial fetch: only v1 exists (no prior versions). After revise: a v1 row
  // is the prior-version snapshot the modal compares against.
  const versionsBeforeRevise: BookVersion[] = [
    {
      id: 1,
      book_id: 'book-1',
      version: 1,
      pages_json: '[]',
      description: null,
      characters_json: null,
      created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      pages: [
        { page_number: 1, text: 'Original page 1 text', illustrationDescription: 'd1' },
        { page_number: 2, text: 'Original page 2 text', illustrationDescription: 'd2' },
      ],
    },
  ]

  const versionsAfterRevise: BookVersion[] = [
    {
      id: 1,
      book_id: 'book-1',
      version: 1,
      pages_json: '[]',
      description: null,
      characters_json: null,
      created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      pages: [
        { page_number: 1, text: 'Original page 1 text', illustrationDescription: 'd1' },
        { page_number: 2, text: 'Original page 2 text', illustrationDescription: 'd2' },
      ],
    },
  ]

  it('shows a banner after revise and opens a side-by-side modal comparing v1 and v2 page text', async () => {
    setupFetchMock({
      book: v1Book,
      versions: versionsBeforeRevise,
      revised: v2Revised,
      versionsAfterRevise,
    })

    renderBookDetail()

    // Wait for the page to render with the revise form.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /revise story/i })).toBeInTheDocument()
    })

    // No banner shown initially — past-session revisions don't trigger it.
    expect(screen.queryByText(/see what changed/i)).not.toBeInTheDocument()

    // Type feedback and submit the revise call.
    const textarea = screen.getByPlaceholderText(/Make the ending happier/i)
    fireEvent.change(textarea, { target: { value: 'Make it funnier' } })
    fireEvent.click(screen.getByRole('button', { name: /revise story/i }))

    // Banner appears with the new version number.
    await waitFor(() => {
      expect(screen.getByText(/Story revised to v2 — see what changed/i)).toBeInTheDocument()
    })

    // Wait for the "Show changes" button to be ready (versions fetch resolved).
    const showChanges = await screen.findByRole('button', { name: /show changes/i })
    fireEvent.click(showChanges)

    // Modal renders with the v1 → v2 title and both texts side-by-side.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText('v1 → v2')).toBeInTheDocument()
    expect(screen.getByText('Original page 1 text')).toBeInTheDocument()
    expect(screen.getByText('Original page 2 text')).toBeInTheDocument()
    expect(screen.getByText('Revised page 1 text')).toBeInTheDocument()
    expect(screen.getByText('Revised page 2 text')).toBeInTheDocument()

    // Dismiss the modal via the Close button.
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // Banner is also cleared after closing the modal.
    expect(screen.queryByText(/see what changed/i)).not.toBeInTheDocument()
  })
})

describe('BookDetail — Cast panel + approve-cast soft gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const portraitUrl = '/uploads/illustrations/book-1/portrait-1000.png'

  // A draft book whose required cast (primary + antagonist) has NO portraits yet.
  const castBook: BookWithPages = {
    ...baseBook,
    characters: [
      { role: 'primary', name: 'Pip the Fox', descriptor: 'a curious red fox', portrait_url: null },
      { role: 'antagonist', name: 'Grim the Crow', descriptor: 'a grumpy crow', portrait_url: null },
      { role: 'supporting', name: 'Mossy', descriptor: 'a wise old turtle', portrait_url: null },
    ],
  }

  // Same cast but every required character has a portrait — cast is "approved".
  const approvedCastBook: BookWithPages = {
    ...baseBook,
    characters: [
      { role: 'primary', name: 'Pip the Fox', descriptor: 'a curious red fox', portrait_url: portraitUrl },
      { role: 'antagonist', name: 'Grim the Crow', descriptor: 'a grumpy crow', portrait_url: portraitUrl },
      { role: 'supporting', name: 'Mossy', descriptor: 'a wise old turtle', portrait_url: null },
    ],
  }

  // Mock fetch: GET book + GET versions + POST portrait (returns a hydrated book
  // with the generated portrait patched onto the addressed character).
  function setupCastMock(opts: { book: BookWithPages; portraitResult?: BookWithPages }) {
    const calls: FetchCall[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push({ url, init })
      const method = init?.method ?? 'GET'

      if (url === '/api/books/book-1' && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(opts.book), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      }
      if (url === '/api/books/book-1/versions' && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(versionsResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      }
      if (/^\/api\/books\/book-1\/characters\/\d+\/portrait$/.test(url) && method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify(opts.portraitResult ?? opts.book), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify({ error: `unmocked ${method} ${url}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })
    return { calls }
  }

  it('renders a row per character with name and role, and a thumbnail only when portrait_url is set', async () => {
    setupCastMock({ book: approvedCastBook })
    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText('Cast portraits')).toBeInTheDocument()
    })

    // One row per character — names render. (Names also appear in the header
    // Cast pills, so each name is present at least once via getAllByText.)
    expect(screen.getAllByText('Pip the Fox').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Grim the Crow').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Mossy').length).toBeGreaterThan(0)
    // Role chips in the Cast panel.
    expect(screen.getByText('primary')).toBeInTheDocument()
    expect(screen.getByText('antagonist')).toBeInTheDocument()

    // Required characters (primary + antagonist) have portrait thumbnails.
    expect(screen.getByAltText('Portrait of Pip the Fox')).toBeInTheDocument()
    expect(screen.getByAltText('Portrait of Grim the Crow')).toBeInTheDocument()
    // The supporting character has no portrait_url -> no thumbnail, placeholder instead.
    expect(screen.queryByAltText('Portrait of Mossy')).not.toBeInTheDocument()
    expect(screen.getByLabelText('No portrait for Mossy yet')).toBeInTheDocument()
  })

  it('clicking Generate portrait calls the portrait endpoint and renders the returned portrait', async () => {
    const { calls } = setupCastMock({ book: castBook, portraitResult: approvedCastBook })
    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText('Cast portraits')).toBeInTheDocument()
    })

    // Initially no thumbnail for Pip (primary, index 0).
    expect(screen.queryByAltText('Portrait of Pip the Fox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /generate portrait for pip the fox/i }))

    // The POST hits the index-0 portrait route with auth.
    await waitFor(() => {
      const portraitCall = calls.find(c => c.url === '/api/books/book-1/characters/0/portrait')
      expect(portraitCall).toBeDefined()
      expect(portraitCall?.init?.method).toBe('POST')
      const headers = portraitCall?.init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer test-token')
    })

    // The returned hydrated book repaints the thumbnail.
    await waitFor(() => {
      expect(screen.getByAltText('Portrait of Pip the Fox')).toBeInTheDocument()
    })
  })

  it('disables Illustrate All until required characters have portraits', async () => {
    setupCastMock({ book: castBook })
    renderBookDetail()

    const illustrateBtn = await screen.findByRole('button', { name: /illustrate all/i })
    expect(illustrateBtn).toBeDisabled()
    // The nudge copy is shown.
    expect(screen.getByText(/approve cast to illustrate with consistent characters/i)).toBeInTheDocument()
  })

  it('enables Illustrate All when required characters all have portraits (cast approved)', async () => {
    setupCastMock({ book: approvedCastBook })
    renderBookDetail()

    const illustrateBtn = await screen.findByRole('button', { name: /illustrate all/i })
    expect(illustrateBtn).toBeEnabled()
    expect(screen.getByText(/cast approved/i)).toBeInTheDocument()
  })

  it('re-enables Illustrate All via the "Skip portraits" affordance', async () => {
    setupCastMock({ book: castBook })
    renderBookDetail()

    const illustrateBtn = await screen.findByRole('button', { name: /illustrate all/i })
    expect(illustrateBtn).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /skip portraits — illustrate anyway/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /illustrate all/i })).toBeEnabled()
    })
  })
})

describe('BookDetail — theater mode', () => {
  // NOTE: planner deliberately omitted a back-button-style navigation test
  // (planned case #5) — exercising `MemoryRouter`'s history to assert that the
  // browser Back button exits theater mode is too brittle at the RTL layer
  // (the v7 router's history APIs aren't ergonomic to drive from a test).
  // Manual verify step in Task 2's checklist (browser Back button exits
  // theater mode) covers that acceptance criterion instead.

  beforeEach(() => {
    vi.restoreAllMocks()
    capturedTheaterProp = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes theater=false to BookSpread and applies max-w-4xl when URL has no theater param', async () => {
    setupFetchMock({})
    const { container } = renderBookDetail()

    // Wait for the book to load so BookDetail renders the spread (and our mock
    // captures the prop).
    await waitFor(() => {
      expect(screen.getByTestId('book-spread')).toBeInTheDocument()
    })

    expect(capturedTheaterProp).toBe(false)

    // The page wrapper is the outermost <div> returned by BookDetail. With no
    // ?theater=1 in the URL it should carry the narrow max-w-4xl class and
    // NOT the wide theater max-width.
    const pageWrapper = container.firstChild as HTMLElement
    expect(pageWrapper.className).toContain('max-w-4xl')
    expect(pageWrapper.className).not.toContain('max-w-[min(95vw,1700px)]')
  })

  it('passes theater=true to BookSpread and applies max-w-[min(95vw,1700px)] when URL has ?theater=1', async () => {
    setupFetchMock({})
    const { container } = renderBookDetail({ search: '?theater=1' })

    await waitFor(() => {
      expect(screen.getByTestId('book-spread')).toBeInTheDocument()
    })

    expect(capturedTheaterProp).toBe(true)

    const pageWrapper = container.firstChild as HTMLElement
    expect(pageWrapper.className).toContain('max-w-[min(95vw,1700px)]')
    expect(pageWrapper.className).not.toContain('max-w-4xl')
  })

  it('adds ?theater=1 to the URL when the toggle callback runs from a no-param start', async () => {
    setupFetchMock({})
    renderBookDetail()

    // Wait for the stub button (which the mocked BookSpread renders) and
    // confirm the starting state.
    const stubBtn = await screen.findByRole('button', { name: /theater-toggle-stub/i })
    expect(capturedTheaterProp).toBe(false)

    // Click the stub — this invokes the lifted onToggleTheater callback which
    // updates the URL and triggers a re-render with the new prop.
    fireEvent.click(stubBtn)

    await waitFor(() => {
      expect(capturedTheaterProp).toBe(true)
    })
  })

  it('removes ?theater=1 from the URL when the toggle callback runs while theater is on', async () => {
    setupFetchMock({})
    renderBookDetail({ search: '?theater=1' })

    const stubBtn = await screen.findByRole('button', { name: /theater-toggle-stub/i })
    expect(capturedTheaterProp).toBe(true)

    fireEvent.click(stubBtn)

    await waitFor(() => {
      expect(capturedTheaterProp).toBe(false)
    })
  })
})

describe('BookDetail — non-2xx book fetch (#59 regression)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Before the fix, fetchBook called r.json() unconditionally. A 404 body
  // ({ error: ... }) was stored as `book` — truthy, so it slipped past the
  // `if (!book)` guard, `isDraft` evaluated false, and the non-draft branch
  // crashed at `book.price.toFixed`. The fix resolves any non-2xx to null so
  // the "Book not found" guard catches it instead.
  it('renders "Book not found" instead of crashing when the book GET returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/books/book-1') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Book not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: `unmocked ${url}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText('Book not found')).toBeInTheDocument()
    })
    // The price span from the non-draft branch must never render off a poisoned
    // book object.
    expect(screen.queryByText(/\$\d+\.\d{2}/)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// PS1 — Download PDF button
// ---------------------------------------------------------------------------
// The download is a blob + synthetic-anchor click, neither of which jsdom
// implements. We stub URL.createObjectURL / revokeObjectURL and spy on the
// anchor's click so the round trip is observable without a real navigation.
describe('BookDetail — Download PDF', () => {
  const publishedBook: BookWithPages = { ...baseBook, status: 'published' }
  let clickSpy: ReturnType<typeof vi.spyOn>
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let downloadedBlobs: Blob[]
  let originalCreate: typeof URL.createObjectURL | undefined
  let originalRevoke: typeof URL.revokeObjectURL | undefined

  beforeEach(() => {
    vi.restoreAllMocks()
    originalCreate = URL.createObjectURL
    originalRevoke = URL.revokeObjectURL
    downloadedBlobs = []
    createObjectURL = vi.fn((blob: Blob) => {
      downloadedBlobs.push(blob)
      return 'blob:mock-pdf-url'
    })
    revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    URL.createObjectURL = originalCreate as typeof URL.createObjectURL
    URL.revokeObjectURL = originalRevoke as typeof URL.revokeObjectURL
    vi.restoreAllMocks()
  })

  it('renders the button with an accessible name for a signed-in reader', async () => {
    setupFetchMock({ book: publishedBook })
    renderBookDetail()

    const button = await screen.findByRole('button', { name: 'Download PDF' })
    expect(button).toHaveAttribute('aria-label', 'Download PDF')
    expect(button).toBeEnabled()
  })

  it('POSTs to the pdf route with the bearer token and triggers a download', async () => {
    const { calls } = setupFetchMock({ book: publishedBook })
    renderBookDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }))

    await waitFor(() => {
      expect(calls.some(c => c.url === '/api/books/book-1/pdf')).toBe(true)
    })
    const pdfCall = calls.find(c => c.url === '/api/books/book-1/pdf')
    expect(pdfCall?.init?.method).toBe('POST')
    expect(pdfCall?.init?.body).toBe('{}')
    expect(
      (pdfCall?.init?.headers as Record<string, string> | undefined)?.['Authorization']
    ).toBe('Bearer test-token')

    // Check the error surface before the click. If the fetch→blob path threw,
    // this names the cause instead of leaving a bare "click was called 0 times".
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1)
    }, { timeout: 2000 })
    expect(screen.queryByText(/download failed/i)).not.toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-pdf-url')

    // The blob handed to createObjectURL must carry the server's actual bytes.
    // Without this the suite passed against a body that had been stringified
    // to "[object Blob]" — the download fired, but with garbage in it.
    expect(downloadedBlobs).toHaveLength(1)
    await expect(downloadedBlobs[0]!.text()).resolves.toBe(FAKE_PDF_BODY)
  })

  it('carries a dark: variant on every themed surface of the button', async () => {
    setupFetchMock({ book: publishedBook })
    renderBookDetail()

    const className = (await screen.findByRole('button', { name: 'Download PDF' })).className
    for (const variant of [
      'dark:border-',
      'dark:bg-',
      'dark:text-',
      'dark:hover:bg-',
      'dark:focus-visible:ring-',
    ]) {
      expect(className).toContain(variant)
    }
  })

  it("hides the button on someone else's draft", async () => {
    setupFetchMock({ book: { ...baseBook, status: 'draft', created_by: 'someone-else' } })
    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText('Test Adventure')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument()
  })

  it('surfaces a failed download instead of silently doing nothing', async () => {
    setupFetchMock({ book: publishedBook, pdfStatus: 404 })
    renderBookDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }))

    await waitFor(() => {
      expect(screen.getByText(/download failed \(404\)/i)).toBeInTheDocument()
    })
    expect(clickSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// #20 — "withdraw to edit": PublishStateBar wiring + the two reader-view
// controls that were gated on `isOwner` alone.
// ---------------------------------------------------------------------------
// Task 1 made `POST /:id/illustrate` (and its four siblings) 403 on a published
// book. Before this task the reader view still rendered Regenerate / History /
// Generate illustration for a published owner, so those buttons stopped being
// affordances and started being traps. These tests are the fence on that.
describe('BookDetail — publish state and the reader-view edit controls', () => {
  const illustratedUrl = '/uploads/illustrations/page-1.png'

  // Page 1 illustrated (Regenerate + History), page 2 not (Generate
  // illustration). One book exercises both reader-view control clusters.
  const twoPageBook: BookWithPages = {
    ...baseBook,
    pages: [
      { id: 1, book_id: 'book-1', page_number: 1, text: 'Page 1 current', illustration_description: 'desc 1', illustration_url: illustratedUrl },
      { id: 2, book_id: 'book-1', page_number: 2, text: 'Page 2 current', illustration_description: 'desc 2', illustration_url: null },
    ],
  }

  // PUT /:id/publish and /:id/unpublish respond with `BookSchema` — the book
  // row, with **no** `pages`. The mock mirrors that so the merge in
  // handleWithdraw/handlePublish is actually under test: a naive
  // `setBook(parsed)` would blank the story.
  function bookRowOnly(book: BookWithPages, status: string) {
    const { pages: _pages, ...row } = book
    return { ...row, status }
  }

  function setupPublishFetchMock(opts: {
    book: BookWithPages
    /** Books returned by GETs after the first one — the "second tab" refetch. */
    refetched?: BookWithPages
    illustrateStatus?: number
  }) {
    const calls: FetchCall[] = []
    let bookGets = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push({ url, init })
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

      if (url === '/api/books/book-1' && method === 'GET') {
        bookGets++
        return json(bookGets > 1 && opts.refetched ? opts.refetched : opts.book)
      }
      if (url === '/api/books/book-1/versions' && method === 'GET') return json([])
      if (url === '/api/books/book-1/unpublish' && method === 'PUT') return json(bookRowOnly(opts.book, 'draft'))
      if (url === '/api/books/book-1/publish' && method === 'PUT') return json(bookRowOnly(opts.book, 'published'))
      if (url === '/api/books/book-1/illustrate' && method === 'POST') {
        const status = opts.illustrateStatus ?? 200
        if (status !== 200) {
          return json({ error: 'Published books cannot be edited. Take the book out of the catalog to edit it.' }, status)
        }
        return json(opts.book)
      }
      if (/^\/api\/books\/book-1\/illustrations\/\d+$/.test(url) && method === 'GET') return json([])
      return json({ error: `unmocked ${method} ${url}` }, 500)
    })
    return { calls, bookGets: () => bookGets }
  }

  const readerView = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /reader view/i }))
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows "Edit this book" for a published owner and "Publish changes" for a draft owner', async () => {
    setupPublishFetchMock({ book: { ...twoPageBook, status: 'published' } })
    const { unmount } = renderBookDetail()

    expect(await screen.findByRole('button', { name: /edit this book/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /publish changes/i })).not.toBeInTheDocument()
    unmount()

    vi.restoreAllMocks()
    setupPublishFetchMock({ book: { ...twoPageBook, status: 'draft' } })
    renderBookDetail()

    expect(await screen.findByRole('button', { name: /publish changes/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit this book/i })).not.toBeInTheDocument()
  })

  it('shows no publish-state surface at all to a non-owner', async () => {
    setupPublishFetchMock({ book: { ...twoPageBook, status: 'published', created_by: 'someone-else' } })
    renderBookDetail()

    await waitFor(() => {
      expect(screen.getByText('Test Adventure')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('publish-state-bar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit this book/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /publish changes/i })).not.toBeInTheDocument()
  })

  it('withdraws via PUT /unpublish with the bearer token and re-renders in draft state', async () => {
    const { calls } = setupPublishFetchMock({ book: { ...twoPageBook, status: 'published' } })
    renderBookDetail()

    fireEvent.click(await screen.findByRole('button', { name: /edit this book/i }))
    // The confirm is inline and must be crossed before anything is called.
    expect(calls.find(c => c.url.includes('/unpublish'))).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: /take it out and edit/i }))

    await waitFor(() => {
      const call = calls.find(c => c.url === '/api/books/book-1/unpublish')
      expect(call).toBeDefined()
      expect(call?.init?.method).toBe('PUT')
      expect((call?.init?.headers as Record<string, string> | undefined)?.Authorization).toBe('Bearer test-token')
    })

    // Draft surfaces mount off the merged response...
    expect(await screen.findByRole('button', { name: /publish changes/i })).toBeInTheDocument()
    expect(screen.getByText(/out of the catalog while you edit/i)).toBeInTheDocument()
    // ...and the pages survived the merge, even though /unpublish returns no
    // `pages` field.
    await readerView()
    expect(await screen.findByText('Page 1 current')).toBeInTheDocument()
  })

  it('renders no reader-view illustration controls for a published book (success criterion 8)', async () => {
    setupPublishFetchMock({ book: { ...twoPageBook, status: 'published' } })
    renderBookDetail()
    await readerView()

    // Page 1 is illustrated: neither Regenerate nor History may be offered.
    expect(await screen.findByText('Page 1 current')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^regenerate$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^history$/i })).not.toBeInTheDocument()

    // Page 2 has a description and no illustration: no Generate illustration.
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText('Page 2 current')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /generate illustration/i })).not.toBeInTheDocument()
  })

  it('still renders the reader-view illustration controls for a draft the owner owns', async () => {
    setupPublishFetchMock({ book: { ...twoPageBook, status: 'draft' } })
    renderBookDetail()
    await readerView()

    expect(await screen.findByRole('button', { name: /^regenerate$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^history$/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByRole('button', { name: /generate illustration/i })).toBeInTheDocument()
  })

  it('treats a 403 from an edit route as a stale view: refetches the book instead of surfacing the error', async () => {
    // The book is a draft in this tab; a second tab already republished it.
    const { calls } = setupPublishFetchMock({
      book: { ...twoPageBook, status: 'draft' },
      refetched: { ...twoPageBook, status: 'published' },
      illustrateStatus: 403,
    })
    renderBookDetail()
    await readerView()

    fireEvent.click(await screen.findByRole('button', { name: /^regenerate$/i }))

    // The book is refetched...
    await waitFor(() => {
      expect(calls.filter(c => c.url === '/api/books/book-1' && (c.init?.method ?? 'GET') === 'GET').length)
        .toBeGreaterThanOrEqual(2)
    })
    // ...and the now-published state takes the controls away rather than
    // leaving a button next to the server's raw refusal.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^regenerate$/i })).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/published books cannot be edited/i)).not.toBeInTheDocument()
  })
})
