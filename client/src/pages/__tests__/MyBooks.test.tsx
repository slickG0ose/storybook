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
} = {}) {
  const calls: FetchCall[] = []
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
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
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

function renderMyBooks() {
  return render(
    <MemoryRouter>
      <MyBooks />
    </MemoryRouter>
  )
}

describe('MyBooks — Unpublish', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('unpublishes a published book on confirm and flips the card to draft', async () => {
    const { calls } = setupFetchMock({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderMyBooks()

    // Card renders as Published initially.
    await waitFor(() => {
      expect(screen.getByText('Published')).toBeInTheDocument()
    })

    const unpublishBtn = screen.getByRole('button', { name: /unpublish book/i })
    fireEvent.click(unpublishBtn)

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const confirmMessage = confirmSpy.mock.calls[0]?.[0] as string
    expect(confirmMessage).toMatch(/public catalog/i)
    expect(confirmMessage).toMatch(/draft/i)

    // Unpublish endpoint hit with the right URL + auth header.
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

    fireEvent.click(screen.getByRole('button', { name: /unpublish book/i }))

    // No unpublish call should have been made.
    const unpublishCall = calls.find(c => c.url.includes('/unpublish'))
    expect(unpublishCall).toBeUndefined()
    // Card still shows Published.
    expect(screen.getByText('Published')).toBeInTheDocument()
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
