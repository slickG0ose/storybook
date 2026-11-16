import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import MyBooks from '../MyBooks'
import { AUTH_EXPIRED_EVENT } from '../../lib/authFetch'
import { ToastProvider } from '../../context/ToastContext'
import type { Book, Page } from '../../types'

type BookWithMaybePages = Book & { pages?: Page[] }

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  token: 'test-token',
  role: 'user' as const,
}

const publishedBook: Book = {
  id: 'book-1',
  title: 'Published Adventure',
  author: 'AI Author',
  description: 'A published story.',
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
  status: 'published',
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
}

const unpublishedBook: Book = {
  ...publishedBook,
  status: 'draft',
}

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

interface FetchCall {
  url: string
  init?: RequestInit
}

function setupFetchMock(opts: {
  books?: BookWithMaybePages[]
  unpublished?: Book
  unpublishStatus?: number
  /** Hold the unpublish response open so the busy state can be observed. */
  deferUnpublish?: boolean
  /** Reject the unpublish fetch outright, to exercise the handler's catch branch. */
  unpublishRejects?: boolean
} = {}) {
  const calls: FetchCall[] = []
  let releaseUnpublish: () => void = () => {}
  const unpublishGate = new Promise<void>(resolve => {
    releaseUnpublish = resolve
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    const method = init?.method ?? 'GET'

    if (url === '/api/books/mine' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.books ?? [publishedBook]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }
    if (url === '/api/books/book-1/unpublish' && method === 'PUT') {
      if (opts.unpublishRejects) return Promise.reject(new TypeError('Failed to fetch'))
      const status = opts.unpublishStatus ?? 200
      const body = status === 200 ? opts.unpublished ?? unpublishedBook : { error: 'failed' }
      const respond = () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      return opts.deferUnpublish ? unpublishGate.then(respond) : Promise.resolve(respond())
    }
    if (url === '/api/books/book-1/publish' && method === 'PUT') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.unpublished ?? publishedBook), {
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
  return { calls, releaseUnpublish: () => releaseUnpublish() }
}

/**
 * The real `ToastProvider`, not a mock: failures on this page now land in the shared toast
 * host, so the assertion this file cares about is the *rendered text* of the message. The
 * provider renders `ErrorToastHost` itself, so wrapping it is all the wiring there is.
 */
function renderMyBooks() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <MyBooks />
      </ToastProvider>
    </MemoryRouter>
  )
}

/** Toast assertions are always scoped to the host — inline `role="alert"` nodes exist elsewhere. */
function toastHost() {
  return within(screen.getByTestId('error-toast-host'))
}

/**
 * Authors see Private / Public, not Draft / Published: a public book is readable by anyone
 * who visits, signed in or not, so both directions say so and ask first. These tests pin the
 * vocabulary; the strings themselves are the product decision under review.
 */
describe('MyBooks — Make private / Make public', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('labels the public-book control "Make private", not unpublishing', async () => {
    setupFetchMock({})

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Public')).toBeInTheDocument()
    })

    const editBtn = screen.getByRole('button', { name: /make book private/i })
    expect(editBtn).toHaveTextContent('Make private')
    // The old withdrawal-and-abandonment vocabulary is gone from the card entirely.
    expect(screen.queryByText(/unpublish/i)).not.toBeInTheDocument()
  })

  it('makes a public book private on confirm and flips the card', async () => {
    const { calls } = setupFetchMock({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderMyBooks()

    // Card renders as Public initially.
    await waitFor(() => {
      expect(screen.getByText('Public')).toBeInTheDocument()
    })

    const editBtn = screen.getByRole('button', { name: /make book private/i })
    fireEvent.click(editBtn)

    // The confirm carries PublishStateBar's wording: who can see it afterwards, that it
    // can be edited again, and that an existing buyer's receipt survives it.
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const confirmMessage = confirmSpy.mock.calls[0]?.[0] as string
    expect(confirmMessage).toContain('Published Adventure')
    expect(confirmMessage).toMatch(/only you will be able to see it/i)
    expect(confirmMessage).toMatch(/edit it again/i)
    expect(confirmMessage).toMatch(/keeps their receipt/i)

    // Unpublish endpoint hit with the right URL + auth header — same route, new words.
    await waitFor(() => {
      const call = calls.find(c => c.url === '/api/books/book-1/unpublish')
      expect(call).toBeDefined()
      expect(call?.init?.method).toBe('PUT')
      const headers = new Headers(call?.init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer test-token')
    })

    // Card status badge flips to Private after the response.
    await waitFor(() => {
      expect(screen.getByText('Private')).toBeInTheDocument()
    })
    expect(screen.queryByText('Public')).not.toBeInTheDocument()
    // And the Make public button (which only renders for private books) is now present.
    expect(screen.getByRole('button', { name: /make book public/i })).toBeInTheDocument()
  })

  it('does not call the unpublish endpoint when the user cancels the confirm', async () => {
    const { calls } = setupFetchMock({})
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Public')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /make book private/i }))

    // No unpublish call should have been made.
    const unpublishCall = calls.find(c => c.url.includes('/unpublish'))
    expect(unpublishCall).toBeUndefined()
    // Card still shows Public.
    expect(screen.getByText('Public')).toBeInTheDocument()
  })

  it('reads "Making private..." while the request is in flight', async () => {
    const { releaseUnpublish } = setupFetchMock({ deferUnpublish: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Public')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /make book private/i }))

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /make book private/i })
      expect(btn).toHaveTextContent('Making private...')
      expect(btn).toBeDisabled()
    })

    releaseUnpublish()
    await waitFor(() => {
      expect(screen.getByText('Private')).toBeInTheDocument()
    })
  })

  it('explains a failed withdrawal in the same vocabulary', async () => {
    setupFetchMock({ unpublishStatus: 500 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Public')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /make book private/i }))

    // The message is visible in the DOM, not handed to a blocking browser dialog (#115).
    await waitFor(() => {
      expect(toastHost().getByText(/make that book private/i)).toBeInTheDocument()
    })
    expect(toastHost().getByText(/refresh to see the latest state/i)).toBeInTheDocument()
    // Still public — the card did not lie about the outcome.
    expect(screen.getByText('Public')).toBeInTheDocument()
  })

  it('explains a withdrawal that never reached the server', async () => {
    setupFetchMock({ unpublishRejects: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Public')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /make book private/i }))

    await waitFor(() => {
      expect(toastHost().getByText(/check your connection and try again/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Public')).toBeInTheDocument()
    // The busy state released even though the request threw.
    expect(screen.getByRole('button', { name: /make book private/i })).not.toBeDisabled()
  })

  it('asks before making a private book public, then calls PUT /publish', async () => {
    const { calls } = setupFetchMock({ books: [unpublishedBook] })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Private')).toBeInTheDocument()
    })

    const publishBtn = screen.getByRole('button', { name: /make book public/i })
    expect(publishBtn).toHaveTextContent('Make public')
    fireEvent.click(publishBtn)

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const confirmMessage = confirmSpy.mock.calls[0]?.[0] as string
    expect(confirmMessage).toContain(unpublishedBook.title)
    expect(confirmMessage).toMatch(/anyone who visits StoryBook will be able to find and buy it, without signing in/i)

    await waitFor(() => {
      const call = calls.find(c => c.url === '/api/books/book-1/publish')
      expect(call).toBeDefined()
      expect(call?.init?.method).toBe('PUT')
      const headers = new Headers(call?.init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer test-token')
    })
  })
})

describe('MyBooks — Make public cancelled', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not call the publish endpoint when the user cancels the confirm', async () => {
    const { calls } = setupFetchMock({ books: [unpublishedBook] })
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Private')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /make book public/i }))

    expect(calls.find(c => c.url.endsWith('/publish'))).toBeUndefined()
    expect(screen.getByText('Private')).toBeInTheDocument()
  })
})

describe('MyBooks — Unillustrated badge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const makePage = (page_number: number, illustration_url: string | null): Page => ({
    id: page_number,
    book_id: 'book-1',
    page_number,
    text: `Page ${page_number} text`,
    illustration_description: `Page ${page_number} description`,
    illustration_url,
  })

  it('shows "{N} unillustrated" badge on a draft with pages missing illustrations', async () => {
    const draftWithPages: BookWithMaybePages = {
      ...unpublishedBook,
      pages: [
        makePage(1, null),
        makePage(2, null),
        makePage(3, 'https://example.com/3.png'),
      ],
    }
    setupFetchMock({ books: [draftWithPages] })

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Private')).toBeInTheDocument()
    })
    expect(screen.getByText('2 unillustrated')).toBeInTheDocument()
  })

  it('does NOT show the unillustrated badge when all pages have illustrations', async () => {
    const draftAllIllustrated: BookWithMaybePages = {
      ...unpublishedBook,
      pages: [
        makePage(1, 'https://example.com/1.png'),
        makePage(2, 'https://example.com/2.png'),
        makePage(3, 'https://example.com/3.png'),
      ],
    }
    setupFetchMock({ books: [draftAllIllustrated] })

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Private')).toBeInTheDocument()
    })
    expect(screen.queryByText(/unillustrated/i)).not.toBeInTheDocument()
  })
})

// Tester build (spec: `.code-captain/specs/tester-commerce-off/spec.md`): nothing is for
// sale, so the withdraw warning must not promise buyers or receipts.
describe('MyBooks — commerce off', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('warns about making a book private without the purchase wording', async () => {
    setupFetchMock({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Public')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /make book private/i }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const confirmMessage = confirmSpy.mock.calls[0]?.[0] as string
    expect(confirmMessage).toContain('Published Adventure')
    expect(confirmMessage).toMatch(/only you will be able to see it/i)
    expect(confirmMessage).not.toMatch(/buy|bought|receipt/i)
  })
})

// A stored cover_url can outlive its file (404 from storage). The tile must then look
// like a book with no cover, not paint the browser's broken image.
describe('MyBooks — cover image fails to load', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to the cover emoji', async () => {
    setupFetchMock({ books: [{ ...publishedBook, cover_url: '/illustrations/book-1/cover.png' }] })
    const { container } = renderMyBooks()
    await screen.findByText(publishedBook.title)

    const img = container.querySelector('img[src="/illustrations/book-1/cover.png"]')
    expect(img).toBeInTheDocument()
    expect(screen.queryByText(publishedBook.cover_emoji)).not.toBeInTheDocument()

    fireEvent.error(img!)

    expect(container.querySelector('img[src="/illustrations/book-1/cover.png"]')).not.toBeInTheDocument()
    expect(screen.getByText(publishedBook.cover_emoji)).toHaveClass('drop-shadow-lg')
  })
})

describe('MyBooks — expired session (401)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches the auth-expired event and leaves the list empty instead of storing the error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Session expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const onExpired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    try {
      renderMyBooks()
      await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1))
      expect((onExpired.mock.calls[0]![0] as CustomEvent).detail).toEqual({ token: 'test-token' })
      await waitFor(() => expect(screen.queryByText('Published Adventure')).not.toBeInTheDocument())
    } finally {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
    }
  })
})
