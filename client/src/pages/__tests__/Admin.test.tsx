import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Admin from '../Admin'
import { ToastProvider } from '../../context/ToastContext'
import type { AdminUser, AdminBook, OrphanIllustration, AllowedEmail, AdminSpendResponse, User } from '../../types'

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
    image_provider: null,
    image_model: null,
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
    image_provider: null,
    image_model: null,
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

const sampleAllowlist: AllowedEmail[] = [
  {
    email: 'invited@example.com',
    added_by: 'admin@example.com',
    note: 'beta tester',
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
]

const sampleSpend: AdminSpendResponse = {
  dailyByUser: [
    { user_id: 'u-1', email: 'spender@example.com', name: 'Spender', spent_cents: 50 },
    { user_id: 'u-2', email: 'light@example.com', name: 'Light', spent_cents: 4 },
  ],
  monthlyTotalCents: 1800,
  dailyLimitCents: 50,
  monthlyLimitCents: 2000,
  adminBypassEnabled: true,
}

function setupFetchMock(opts: {
  users?: AdminUser[]
  books?: AdminBook[]
  orphans?: OrphanIllustration[]
  allowlist?: AllowedEmail[]
  spend?: AdminSpendResponse
  addAllowlistStatus?: number
  restoredUser?: AdminUser
  restoredBook?: AdminBook
  featuredBook?: AdminBook
  deleteOrphanStatus?: number
  /** Failure injection for the three handlers that now raise toasts. */
  restoreUserStatus?: number
  restoreBookStatus?: number
  featuredStatus?: number
  /** Reject the featured PUT outright, to exercise that handler's catch branch. */
  featuredRejects?: boolean
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
    if (url === '/api/admin/spend' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.spend ?? sampleSpend), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (url === '/api/admin/allowlist' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(opts.allowlist ?? sampleAllowlist), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (url === '/api/admin/allowlist' && method === 'POST') {
      const status = opts.addAllowlistStatus ?? 201
      const body = init?.body ? (JSON.parse(init.body as string) as { email: string; note?: string }) : { email: '' }
      if (status >= 200 && status < 300) {
        const created: AllowedEmail = {
          email: body.email.toLowerCase(),
          added_by: 'admin@example.com',
          note: body.note ?? null,
          created_at: new Date().toISOString(),
        }
        return Promise.resolve(
          new Response(JSON.stringify(created), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'That email is already on the allowlist' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (/^\/api\/admin\/allowlist\/[^/]+$/.test(url) && method === 'DELETE') {
      const email = decodeURIComponent(url.split('/').pop()!)
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, removed: email }), {
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
      if (opts.restoreUserStatus && opts.restoreUserStatus >= 400) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'restore failed' }), {
            status: opts.restoreUserStatus,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
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
      if (opts.restoreBookStatus && opts.restoreBookStatus >= 400) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'restore failed' }), {
            status: opts.restoreBookStatus,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(opts.restoredBook ?? sampleBooks[0]!), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (/^\/api\/admin\/books\/[^/]+\/featured$/.test(url) && method === 'PUT') {
      if (opts.featuredRejects) return Promise.reject(new TypeError('Failed to fetch'))
      if (opts.featuredStatus && opts.featuredStatus >= 400) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'featured failed' }), {
            status: opts.featuredStatus,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
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

/**
 * Wrapped in the real `ToastProvider` — the six admin failure paths that used to call
 * `window.alert()` now render their message into the shared toast host (#115).
 */
function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <ToastProvider>
        <Routes>
          <Route path="/admin" element={<Admin />} />
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
          <Route path="/" element={<div data-testid="home-page">home</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

/**
 * Toast text is always read through the host. A bare `getByRole('alert')` is ambiguous on
 * this page: the orphan rows render their own inline `role="alert"` node.
 */
function toastHost() {
  return within(screen.getByTestId('error-toast-host'))
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

  // ---------------------------------------------------------------------
  // Failure paths (#115). These three handlers used to call `window.alert()` and were
  // untested; the message now has to be *visible*, so it can be asserted on directly.
  // Every assertion is scoped to the toast host — see `toastHost()`.
  // ---------------------------------------------------------------------

  it('shows a toast when restoring a user fails, and the row stays deleted', async () => {
    setupFetchMock({ restoreUserStatus: 500 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAdmin()

    await waitFor(() => {
      expect(screen.getByText('deleted@example.com')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Restore user deleted@example\.com/i }))
    })

    await waitFor(() => {
      expect(toastHost().getByText(/Couldn't restore that user/i)).toBeInTheDocument()
    })
    // The row kept its deleted state — the UI did not optimistically lie.
    expect(screen.getByRole('button', { name: /Restore user deleted@example\.com/i })).toBeInTheDocument()
    expect(screen.getAllByText('Active').length).toBe(1)
  })

  it('shows a toast when restoring a book fails', async () => {
    const deletedBook: AdminBook = {
      ...sampleBooks[1]!,
      deleted_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    }
    setupFetchMock({ books: [deletedBook], restoreBookStatus: 500 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAdmin()

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^Books/ }))
    })

    const restoreBtn = await screen.findByRole('button', { name: /Restore book Unfeatured Book/i })
    await act(async () => {
      fireEvent.click(restoreBtn)
    })

    await waitFor(() => {
      expect(toastHost().getByText(/Couldn't restore that book/i)).toBeInTheDocument()
    })
    // Still deleted, so the restore affordance is still on the row.
    expect(screen.getByRole('button', { name: /Restore book Unfeatured Book/i })).toBeInTheDocument()
  })

  it('shows a toast when the featured toggle never reaches the server, and does not flip the row', async () => {
    // The `catch` branch rather than `!res.ok`, so both message variants are covered.
    setupFetchMock({ featuredRejects: true })
    renderAdmin()

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^Books/ }))
    })

    const unfeatureBtn = await screen.findByRole('button', { name: /Unfeature Featured Book/i })
    await act(async () => {
      fireEvent.click(unfeatureBtn)
    })

    await waitFor(() => {
      expect(toastHost().getByText(/Couldn't update featured state/i)).toBeInTheDocument()
    })
    expect(toastHost().getByText(/check your connection and try again/i)).toBeInTheDocument()
    // The label did not flip — the book is still featured.
    expect(screen.getByRole('button', { name: /Unfeature Featured Book/i })).toBeInTheDocument()
    // Anchored: /Feature Featured Book/ would also match "Unfeature Featured Book".
    expect(screen.queryByRole('button', { name: /^Feature Featured Book$/i })).not.toBeInTheDocument()
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

  // ---------------------------------------------------------------------
  // Registration allowlist (F4a / #5)
  // ---------------------------------------------------------------------

  it('renders the Allowlist tab and its entries', async () => {
    setupFetchMock()
    renderAdmin()

    const tab = screen.getByRole('button', { name: /^Allowlist/ })
    expect(tab).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(tab)
    })

    await waitFor(() => {
      expect(screen.getByText('invited@example.com')).toBeInTheDocument()
    })
    expect(screen.getByText('beta tester')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
  })

  it('adds an email and shows it in the table', async () => {
    const { calls } = setupFetchMock()
    renderAdmin()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Allowlist/ }))
    })

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email to allow'), {
        target: { value: 'newcomer@example.com' },
      })
      fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'friend' } })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    })

    await waitFor(() => {
      expect(screen.getByText('newcomer@example.com')).toBeInTheDocument()
    })

    const post = calls.find(c => c.url === '/api/admin/allowlist' && c.init?.method === 'POST')
    expect(post).toBeDefined()
    expect(JSON.parse(post!.init!.body as string)).toEqual({
      email: 'newcomer@example.com',
      note: 'friend',
    })
  })

  it('surfaces a duplicate-email error without clearing the input', async () => {
    setupFetchMock({ addAllowlistStatus: 409 })
    renderAdmin()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Allowlist/ }))
    })

    const input = screen.getByLabelText('Email to allow') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'invited@example.com' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    })

    await waitFor(() => {
      expect(screen.getByText(/already on the allowlist/i)).toBeInTheDocument()
    })
    // The address stays put so a typo can be corrected rather than retyped.
    expect(input.value).toBe('invited@example.com')
  })

  it('removes an email from the table', async () => {
    const { calls } = setupFetchMock()
    renderAdmin()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Allowlist/ }))
    })

    await waitFor(() => {
      expect(screen.getByText('invited@example.com')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove invited@example.com from the allowlist' }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByText('invited@example.com')).not.toBeInTheDocument()
    })

    const del = calls.find(c => c.init?.method === 'DELETE' && c.url.includes('/allowlist/'))
    expect(del).toBeDefined()
  })

  it('warns when nobody is allowlisted', async () => {
    setupFetchMock({ allowlist: [] })
    renderAdmin()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Allowlist/ }))
    })

    await waitFor(() => {
      expect(screen.getByText(/no new accounts can be created/i)).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------
  // Spend gates (F4b / #6)
  // ---------------------------------------------------------------------

  it('shows monthly usage against the ceiling', async () => {
    setupFetchMock()
    renderAdmin()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Spend/ }))
    })

    await waitFor(() => {
      expect(screen.getByText(/\$18\.00 of \$20\.00 \(90%\)/)).toBeInTheDocument()
    })
    const bar = screen.getByRole('progressbar', { name: /monthly spend/i })
    expect(bar).toHaveAttribute('aria-valuenow', '90')
  })

  it('lists per-user daily spend', async () => {
    setupFetchMock()
    renderAdmin()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Spend/ }))
    })

    await waitFor(() => {
      expect(screen.getByText('spender@example.com')).toBeInTheDocument()
    })
    expect(screen.getByText('light@example.com')).toBeInTheDocument()
    expect(screen.getByText('$0.04')).toBeInTheDocument()
  })

  it('says generation is paused for everyone once the ceiling is reached', async () => {
    setupFetchMock()
    renderAdmin()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Spend/ }))
    })

    await waitFor(() => {
      expect(screen.getByText(/admins included/i)).toBeInTheDocument()
    })
  })

  it('handles a day with no recorded spend', async () => {
    setupFetchMock({ spend: { ...sampleSpend, dailyByUser: [], monthlyTotalCents: 0 } })
    renderAdmin()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Spend/ }))
    })

    await waitFor(() => {
      expect(screen.getByText(/no ai spend recorded today/i)).toBeInTheDocument()
    })
  })
})
