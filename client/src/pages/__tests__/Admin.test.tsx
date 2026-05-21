import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Admin from '../Admin'
import type { AdminUser, AdminBook, OrphanIllustration, User } from '../../types'

const adminUser: User = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin User',
  token: 'admin-token',
  role: 'admin',
}

const regularUser: User = {
  id: 'user-2',
  email: 'user@example.com',
  name: 'Regular User',
  token: 'user-token',
  role: 'user',
}

let currentUser: User | null = adminUser
let currentAuthLoading = false

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: currentUser,
    loading: currentAuthLoading,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

const sampleUsers: AdminUser[] = [
  {
    id: 'u-1',
    email: 'active@example.com',
    name: 'Active User',
    role: 'user',
    deleted_at: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    id: 'u-2',
    email: 'deleted@example.com',
    name: 'Deleted User',
    role: 'user',
    deleted_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
]

const sampleBooks: AdminBook[] = [
  {
    id: 'b-1',
    title: 'Featured Book',
    author: 'Author',
    description: 'desc',
    theme: 'adventure',
    age_range: '3-5',
    cover_emoji: '🦊',
    cover_color: '#ff6600',
    cover_url: null,
    price: 9.99,
    is_featured: true,
    is_user_created: false,
    status: 'published',
    version: 1,
    characters: [],
    characters_json: null,
    style_descriptor: null,
    style_reference_url: null,
    created_by: null,
    created_at: new Date().toISOString(),
    deleted_at: null,
    creator: null,
  },
  {
    id: 'b-2',
    title: 'Unfeatured Book',
    author: 'Other Author',
    description: 'desc2',
    theme: 'friendship',
    age_range: '3-5',
    cover_emoji: '🐻',
    cover_color: '#cc66ff',
    cover_url: null,
    price: 11.99,
    is_featured: false,
    is_user_created: true,
    status: 'published',
    version: 1,
    characters: [],
    characters_json: null,
    style_descriptor: null,
    style_reference_url: null,
    created_by: 'creator-id',
    created_at: new Date().toISOString(),
    deleted_at: null,
    creator: { email: 'creator@example.com', name: 'Creator' },
  },
]

const sampleOrphans: OrphanIllustration[] = [
  { path: '/illustrations/orphan-1', book_exists: false, soft_deleted: false },
]

interface FetchCall {
  url: string
  init?: RequestInit
}

function setupFetchMock(opts: {
  users?: AdminUser[]
  books?: AdminBook[]
  orphans?: OrphanIllustration[]
  restoredUser?: AdminUser
  restoredBook?: AdminBook
  featuredBook?: AdminBook
  deleteOrphanStatus?: number
} = {}) {
  const calls: FetchCall[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    const method = init?.method ?? 'GET'

    if (url === '/api/admin/users' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.users ?? sampleUsers), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (url === '/api/admin/books' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.books ?? sampleBooks), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (url === '/api/admin/orphan-illustrations' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.orphans ?? sampleOrphans), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (/^\/api\/admin\/orphan-illustrations\/[^/]+$/.test(url) && method === 'DELETE') {
      const status = opts.deleteOrphanStatus ?? 200
      const id = decodeURIComponent(url.split('/').pop()!)
      if (status >= 200 && status < 300) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, deleted: id }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'delete failed' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (/^\/api\/admin\/users\/[^/]+\/restore$/.test(url) && method === 'PUT') {
      const id = url.split('/')[4]!
      const restored: AdminUser =
        opts.restoredUser ?? { ...sampleUsers[1]!, id, deleted_at: null }
      return Promise.resolve(
        new Response(JSON.stringify(restored), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (/^\/api\/admin\/books\/[^/]+\/restore$/.test(url) && method === 'PUT') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.restoredBook ?? sampleBooks[0]!), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (/^\/api\/admin\/books\/[^/]+\/featured$/.test(url) && method === 'PUT') {
      const id = url.split('/')[4]!
      const found = (opts.books ?? sampleBooks).find(b => b.id === id) ?? sampleBooks[0]!
      const body = init?.body ? (JSON.parse(init.body as string) as { is_featured: boolean }) : { is_featured: false }
      const updated: AdminBook = opts.featuredBook ?? { ...found, is_featured: body.is_featured }
      return Promise.resolve(
        new Response(JSON.stringify(updated), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    return Promise.resolve(
      new Response(JSON.stringify({ error: `unmocked ${method} ${url}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return { calls }
}

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<div data-testid="login-page">login</div>} />
        <Route path="/" element={<div data-testid="home-page">home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Admin page', () => {
  beforeEach(() => {
    currentUser = adminUser
    currentAuthLoading = false
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders three tabs and the populated Users table for an admin', async () => {
    setupFetchMock()
    renderAdmin()

    // All three tabs are rendered.
    expect(screen.getByRole('button', { name: /^Users/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Books/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Orphans/ })).toBeInTheDocument()

    // Users table populated from mocked fetch.
    await waitFor(() => {
      expect(screen.getByText('active@example.com')).toBeInTheDocument()
    })
    expect(screen.getByText('deleted@example.com')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    // Status badge contains "Deleted {relative time}" (e.g. "Deleted 30m ago").
    expect(screen.getByText(/Deleted \d+m ago/)).toBeInTheDocument()
  })

  it('redirects to /login when not authenticated', async () => {
    currentUser = null
    setupFetchMock()
    renderAdmin()

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
  })

  it('redirects to / when authenticated but role is not admin', async () => {
    currentUser = regularUser
    setupFetchMock()
    renderAdmin()

    await waitFor(() => {
      expect(screen.getByTestId('home-page')).toBeInTheDocument()
    })
  })

  it('restores a soft-deleted user on confirm and updates local state', async () => {
    const { calls } = setupFetchMock()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAdmin()

    await waitFor(() => {
      expect(screen.getByText('deleted@example.com')).toBeInTheDocument()
    })

    const restoreBtn = screen.getByRole('button', { name: /Restore user deleted@example\.com/i })
    await act(async () => {
      fireEvent.click(restoreBtn)
    })
    expect(confirmSpy).toHaveBeenCalledTimes(1)

    // Right URL + auth header.
    await waitFor(() => {
      const call = calls.find(c => c.url === '/api/admin/users/u-2/restore')
      expect(call).toBeDefined()
      expect(call?.init?.method).toBe('PUT')
      const headers = call?.init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer admin-token')
    })

    // The "Deleted" status badge for that row should be gone — replaced with Active.
    await waitFor(() => {
      const activeCells = screen.getAllByText('Active')
      // Both users now Active (was 1, now 2).
      expect(activeCells.length).toBe(2)
    })
  })

  describe('Orphans tab — delete', () => {
    const multipleOrphans: OrphanIllustration[] = [
      { path: '/illustrations/orphan-1', book_exists: false, soft_deleted: false },
      { path: '/illustrations/orphan-2', book_exists: true, soft_deleted: true },
    ]

    async function switchToOrphansTab() {
      const orphansBtn = await screen.findByRole('button', { name: /^Orphans/ })
      await act(async () => {
        fireEvent.click(orphansBtn)
      })
    }

    it('renders a Delete button on each orphan row', async () => {
      setupFetchMock({ orphans: multipleOrphans })
      renderAdmin()
      await switchToOrphansTab()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Delete orphan orphan-1/i })).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: /Delete orphan orphan-2/i })).toBeInTheDocument()
    })

    it('does nothing when the confirm dialog is cancelled', async () => {
      const { calls } = setupFetchMock({ orphans: multipleOrphans })
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderAdmin()
      await switchToOrphansTab()

      const deleteBtn = await screen.findByRole('button', { name: /Delete orphan orphan-1/i })
      await act(async () => {
        fireEvent.click(deleteBtn)
      })

      expect(confirmSpy).toHaveBeenCalledTimes(1)
      // No DELETE call was issued, and the row is still on screen.
      expect(calls.some(c => c.init?.method === 'DELETE')).toBe(false)
      expect(screen.getByText('/illustrations/orphan-1')).toBeInTheDocument()
    })

    it('removes the row on confirm + success, without refetching the list', async () => {
      const { calls } = setupFetchMock({ orphans: multipleOrphans })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      renderAdmin()
      await switchToOrphansTab()

      const deleteBtn = await screen.findByRole('button', { name: /Delete orphan orphan-1/i })
      await act(async () => {
        fireEvent.click(deleteBtn)
      })

      // The DELETE went to the right URL with auth.
      await waitFor(() => {
        const call = calls.find(c => c.url === '/api/admin/orphan-illustrations/orphan-1')
        expect(call).toBeDefined()
        expect(call?.init?.method).toBe('DELETE')
        const headers = call?.init?.headers as Record<string, string> | undefined
        expect(headers?.Authorization).toBe('Bearer admin-token')
      })

      // Row disappears from local state.
      await waitFor(() => {
        expect(screen.queryByText('/illustrations/orphan-1')).not.toBeInTheDocument()
      })
      // The other orphan row is still there — not a full refetch.
      expect(screen.getByText('/illustrations/orphan-2')).toBeInTheDocument()
      // And we didn't refetch the orphan list.
      const listFetches = calls.filter(
        c => c.url === '/api/admin/orphan-illustrations' && (c.init?.method ?? 'GET') === 'GET',
      )
      expect(listFetches.length).toBe(1)
    })

    it('shows an inline error on the row when the delete fails', async () => {
      setupFetchMock({ orphans: multipleOrphans, deleteOrphanStatus: 409 })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      renderAdmin()
      await switchToOrphansTab()

      const deleteBtn = await screen.findByRole('button', { name: /Delete orphan orphan-1/i })
      await act(async () => {
        fireEvent.click(deleteBtn)
      })

      // Row stays, and an alert with the error text shows up.
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
      expect(screen.getByText('/illustrations/orphan-1')).toBeInTheDocument()
    })
  })

  it('toggles featured for a book — fires PUT with inverted value and updates local state', async () => {
    const { calls } = setupFetchMock()
    renderAdmin()

    // Switch to Books tab.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Books/ })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^Books/ }))

    await waitFor(() => {
      expect(screen.getByText('Featured Book')).toBeInTheDocument()
    })

    // Featured Book (is_featured: 1) — button has unfeature label.
    const unfeatureBtn = screen.getByRole('button', { name: /Unfeature Featured Book/i })
    await act(async () => {
      fireEvent.click(unfeatureBtn)
    })

    await waitFor(() => {
      const call = calls.find(c => c.url === '/api/admin/books/b-1/featured')
      expect(call).toBeDefined()
      expect(call?.init?.method).toBe('PUT')
      const body = JSON.parse(call?.init?.body as string) as { is_featured: boolean }
      expect(body.is_featured).toBe(false)
    })

    // After update, that book should now be unfeatured (button label flips).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Feature Featured Book/i })).toBeInTheDocument()
    })
  })
})
