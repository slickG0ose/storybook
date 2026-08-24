import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import MyBooks from '../MyBooks'
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

function renderMyBooks() {
  return render(
    <MemoryRouter>
      <MyBooks />
    </MemoryRouter>
  )
}

/**
 * Task 6 of the "withdraw to edit" spec: the published-book control is an *edit* affordance
 * whose consequence is leaving the catalog, not a bare "Unpublish". These tests pin the
 * vocabulary — the strings themselves are the product decision under review.
 */
describe('MyBooks — Edit this book (withdraw to edit)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('labels the published-book control as editing, not unpublishing', async () => {
    setupFetchMock({})

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Published')).toBeInTheDocument()
    })

    const editBtn = screen.getByRole('button', { name: /edit this book/i })
    expect(editBtn).toHaveTextContent('Edit this book')
    // The old withdrawal-and-abandonment vocabulary is gone from the card entirely.
    expect(screen.queryByText(/unpublish/i)).not.toBeInTheDocument()
  })

  it('withdraws a published book on confirm and flips the card to draft', async () => {
    const { calls } = setupFetchMock({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderMyBooks()

    // Card renders as Published initially.
    await waitFor(() => {
      expect(screen.getByText('Published')).toBeInTheDocument()
    })

    const editBtn = screen.getByRole('button', { name: /edit this book/i })
    fireEvent.click(editBtn)

    // The confirm carries PublishStateBar's wording: what leaving the catalog costs, and
    // the reassurance that an existing buyer's receipt survives it.
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const confirmMessage = confirmSpy.mock.calls[0]?.[0] as string
    expect(confirmMessage).toContain('Published Adventure')
    expect(confirmMessage).toMatch(/out of the catalog/i)
    expect(confirmMessage).toMatch(/find or buy it until you publish again/i)
    expect(confirmMessage).toMatch(/keeps their receipt/i)

    // Unpublish endpoint hit with the right URL + auth header — same route, new words.
    await waitFor(() => {
      const call = calls.find(c => c.url === '/api/books/book-1/unpublish')
      expect(call).toBeDefined()
      expect(call?.init?.method).toBe('PUT')
      const headers = call?.init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer test-token')
    })

    // Card status badge flips to Draft after the response.
    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument()
    })
    expect(screen.queryByText('Published')).not.toBeInTheDocument()
    // And the Publish button (which only renders for drafts) is now present.
    expect(screen.getByRole('button', { name: /publish book/i })).toBeInTheDocument()
  })

  it('does not call the unpublish endpoint when the user cancels the confirm', async () => {
    const { calls } = setupFetchMock({})
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Published')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /edit this book/i }))

    // No unpublish call should have been made.
    const unpublishCall = calls.find(c => c.url.includes('/unpublish'))
    expect(unpublishCall).toBeUndefined()
    // Card still shows Published.
    expect(screen.getByText('Published')).toBeInTheDocument()
  })

  it('reads "Taking out..." while the withdrawal is in flight', async () => {
    const { releaseUnpublish } = setupFetchMock({ deferUnpublish: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Published')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /edit this book/i }))

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /edit this book/i })
      expect(btn).toHaveTextContent('Taking out...')
      expect(btn).toBeDisabled()
    })

    releaseUnpublish()
    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument()
    })
  })

  it('explains a failed withdrawal in the same vocabulary', async () => {
    setupFetchMock({ unpublishStatus: 500 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Published')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /edit this book/i }))

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1)
    })
    expect(alertSpy.mock.calls[0]?.[0] as string).toMatch(/take that book out of the catalog/i)
    // Still published — the card did not lie about the outcome.
    expect(screen.getByText('Published')).toBeInTheDocument()
  })

  it('leaves the draft-book Publish control unchanged', async () => {
    const { calls } = setupFetchMock({ books: [unpublishedBook] })

    renderMyBooks()

    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument()
    })

    const publishBtn = screen.getByRole('button', { name: /publish book/i })
    expect(publishBtn).toHaveTextContent('Publish')
    fireEvent.click(publishBtn)

    await waitFor(() => {
      const call = calls.find(c => c.url === '/api/books/book-1/publish')
      expect(call).toBeDefined()
      expect(call?.init?.method).toBe('PUT')
      const headers = call?.init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer test-token')
    })
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
      expect(screen.getByText('Draft')).toBeInTheDocument()
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
      expect(screen.getByText('Draft')).toBeInTheDocument()
    })
    expect(screen.queryByText(/unillustrated/i)).not.toBeInTheDocument()
  })
})
