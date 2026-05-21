import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import BookDetail from '../BookDetail'
import type { BookWithPages, BookVersion, IllustrationVersion } from '../../types'

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
  useCart: () => ({
    items: [],
    total: 0,
    sessionId: 'test-session',
    addToCart: vi.fn().mockResolvedValue(undefined),
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    fetchCart: vi.fn(),
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
// version-history flow rather than the spread renderer.
vi.mock('../../components/BookSpread', () => ({
  default: () => <div data-testid="book-spread" />,
}))

function renderBookDetail() {
  return render(
    <MemoryRouter initialEntries={['/book/book-1']}>
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

function setupFetchMock(opts: {
  book?: BookWithPages
  versions?: BookVersion[]
  restored?: BookWithPages
  illustrationVersions?: IllustrationVersion[]
  revised?: BookWithPages
  versionsAfterRevise?: BookVersion[]
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
