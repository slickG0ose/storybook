import { useState, useEffect, useCallback } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Shield, Users, BookOpen, FolderOpen, Loader2, RotateCcw, Star, AlertCircle, Trash2, MailCheck, Plus, Gauge } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/apiBase'
import type { AdminUser, AdminBook, OrphanIllustration, AllowedEmail, AdminSpendResponse } from '../types'

// The orphan listing returns `path` as `/illustrations/<entry>`. The delete
// endpoint takes the entry (directory name) as `:id`.
function orphanIdFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diffMs = Date.now() - then
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

type Tab = 'users' | 'books' | 'orphans' | 'allowlist' | 'spend'

export default function Admin() {
  const { user, loading: authLoading } = useAuth()
  // Called here, above the authLoading / !user / role early returns below, so hook order
  // is unconditional on every render of this component.
  const { showError } = useToast()
  const [tab, setTab] = useState<Tab>('users')

  // Users tab state
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState('')

  // Books tab state
  const [books, setBooks] = useState<AdminBook[]>([])
  const [booksLoading, setBooksLoading] = useState(true)
  const [booksError, setBooksError] = useState('')

  // Orphans tab state
  const [orphans, setOrphans] = useState<OrphanIllustration[]>([])
  const [orphansLoading, setOrphansLoading] = useState(true)
  const [orphansError, setOrphansError] = useState('')
  // Per-row state for the Delete action, keyed by directory entry id.
  const [orphanDeleting, setOrphanDeleting] = useState<Record<string, boolean>>({})
  const [orphanRowError, setOrphanRowError] = useState<Record<string, string>>({})

  const [allowlist, setAllowlist] = useState<AllowedEmail[]>([])
  const [allowlistLoading, setAllowlistLoading] = useState(true)
  const [allowlistError, setAllowlistError] = useState('')
  const [allowlistAddError, setAllowlistAddError] = useState('')
  const [allowlistAdding, setAllowlistAdding] = useState(false)
  const [allowlistRemoving, setAllowlistRemoving] = useState<Record<string, boolean>>({})

  const [spend, setSpend] = useState<AdminSpendResponse | null>(null)
  const [spendLoading, setSpendLoading] = useState(true)
  const [spendError, setSpendError] = useState('')

  const token = user?.token

  const fetchUsers = useCallback(async () => {
    if (!token) return
    setUsersLoading(true)
    setUsersError('')
    try {
      const res = await fetch(api('/api/admin/users'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load users')
      const data = (await res.json()) as AdminUser[]
      setUsers(data)
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setUsersLoading(false)
    }
  }, [token])

  const fetchBooks = useCallback(async () => {
    if (!token) return
    setBooksLoading(true)
    setBooksError('')
    try {
      const res = await fetch(api('/api/admin/books'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load books')
      const data = (await res.json()) as AdminBook[]
      setBooks(data)
    } catch (err) {
      setBooksError(err instanceof Error ? err.message : 'Failed to load books')
    } finally {
      setBooksLoading(false)
    }
  }, [token])

  const fetchOrphans = useCallback(async () => {
    if (!token) return
    setOrphansLoading(true)
    setOrphansError('')
    try {
      const res = await fetch(api('/api/admin/orphan-illustrations'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load orphan illustrations')
      const data = (await res.json()) as OrphanIllustration[]
      setOrphans(data)
    } catch (err) {
      setOrphansError(err instanceof Error ? err.message : 'Failed to load orphan illustrations')
    } finally {
      setOrphansLoading(false)
    }
  }, [token])

  const fetchAllowlist = useCallback(async () => {
    if (!token) return
    setAllowlistLoading(true)
    setAllowlistError('')
    try {
      const res = await fetch(api('/api/admin/allowlist'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load the allowlist')
      const data = (await res.json()) as AllowedEmail[]
      setAllowlist(data)
    } catch (err) {
      setAllowlistError(err instanceof Error ? err.message : 'Failed to load the allowlist')
    } finally {
      setAllowlistLoading(false)
    }
  }, [token])

  const addAllowedEmail = async (email: string, note: string) => {
    if (!token) return
    setAllowlistAdding(true)
    setAllowlistAddError('')
    try {
      const res = await fetch(api('/api/admin/allowlist'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...(note.trim() ? { note: note.trim() } : {}) }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || 'Could not add that email')
      }
      const created = (await res.json()) as AllowedEmail
      setAllowlist(prev => [created, ...prev])
    } catch (err) {
      setAllowlistAddError(err instanceof Error ? err.message : 'Could not add that email')
      throw err
    } finally {
      setAllowlistAdding(false)
    }
  }

  const removeAllowedEmail = async (email: string) => {
    if (!token) return
    setAllowlistRemoving(prev => ({ ...prev, [email]: true }))
    try {
      const res = await fetch(api(`/api/admin/allowlist/${encodeURIComponent(email)}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Could not remove that email')
      setAllowlist(prev => prev.filter(a => a.email !== email))
    } catch (err) {
      setAllowlistError(err instanceof Error ? err.message : 'Could not remove that email')
    } finally {
      setAllowlistRemoving(prev => {
        const next = { ...prev }
        delete next[email]
        return next
      })
    }
  }

  const fetchSpend = useCallback(async () => {
    if (!token) return
    setSpendLoading(true)
    setSpendError('')
    try {
      const res = await fetch(api('/api/admin/spend'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load spend')
      setSpend((await res.json()) as AdminSpendResponse)
    } catch (err) {
      setSpendError(err instanceof Error ? err.message : 'Failed to load spend')
    } finally {
      setSpendLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    void fetchUsers()
    void fetchBooks()
    void fetchOrphans()
    void fetchAllowlist()
    void fetchSpend()
  }, [token, fetchUsers, fetchBooks, fetchOrphans, fetchAllowlist, fetchSpend])

  // Wait until auth resolves before deciding to redirect.
  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-20 text-center">
        <div className="animate-pulse text-gray-400 dark:text-gray-500 text-lg">Loading...</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />

  const restoreUser = async (id: string) => {
    if (!token) return
    if (!window.confirm('Restore this user? They will be able to sign in again.')) return
    try {
      const res = await fetch(api(`/api/admin/users/${id}/restore`), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        showError("Couldn't restore that user. Refresh to see the latest state.")
        return
      }
      const updated = (await res.json()) as AdminUser
      setUsers(prev => prev.map(u => (u.id === updated.id ? { ...u, ...updated } : u)))
    } catch {
      showError("Couldn't restore that user. Check your connection and try again.")
    }
  }

  const restoreBook = async (id: string) => {
    if (!token) return
    if (!window.confirm('Restore this book? It will reappear in the catalog.')) return
    try {
      const res = await fetch(api(`/api/admin/books/${id}/restore`), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        showError("Couldn't restore that book. Refresh to see the latest state.")
        return
      }
      const updated = (await res.json()) as AdminBook
      setBooks(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)))
    } catch {
      showError("Couldn't restore that book. Check your connection and try again.")
    }
  }

  const deleteOrphan = async (orphan: OrphanIllustration) => {
    if (!token) return
    const id = orphanIdFromPath(orphan.path)
    if (!id) return
    if (!window.confirm(`Delete orphaned directory ${id}? This cannot be undone.`)) return

    setOrphanDeleting(prev => ({ ...prev, [id]: true }))
    setOrphanRowError(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })

    try {
      const res = await fetch(api(`/api/admin/orphan-illustrations/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        // 404 is "already gone" — treat as success and drop the row.
        if (res.status === 404) {
          setOrphans(prev => prev.filter(o => o.path !== orphan.path))
          return
        }
        // 409 means the directory belongs to a live book — shouldn't happen
        // because the listing filters those out, but surface it cleanly.
        let message = 'Delete failed.'
        if (res.status === 409) message = "Can't delete — directory belongs to a live book."
        else if (res.status === 400) message = 'Delete rejected (invalid path).'
        setOrphanRowError(prev => ({ ...prev, [id]: message }))
        return
      }
      setOrphans(prev => prev.filter(o => o.path !== orphan.path))
    } catch {
      setOrphanRowError(prev => ({ ...prev, [id]: 'Network error. Try again.' }))
    } finally {
      setOrphanDeleting(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const toggleFeatured = async (book: AdminBook) => {
    if (!token) return
    const next = !book.is_featured
    try {
      const res = await fetch(api(`/api/admin/books/${book.id}/featured`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_featured: next }),
      })
      if (!res.ok) {
        showError("Couldn't update featured state. Refresh to see the latest state.")
        return
      }
      const updated = (await res.json()) as AdminBook
      setBooks(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)))
    } catch {
      showError("Couldn't update featured state. Check your connection and try again.")
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-2">
        <Shield size={28} className="text-purple-500" />
        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display">Admin</h1>
      </div>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Manage users, oversee the full catalog (including soft-deleted books), and inspect orphaned illustration directories.
      </p>

      <div className="flex gap-2 mb-6">
        {([
          { id: 'users', label: 'Users', icon: Users, count: users.length },
          { id: 'books', label: 'Books', icon: BookOpen, count: books.length },
          { id: 'orphans', label: 'Orphans', icon: FolderOpen, count: orphans.length },
          { id: 'allowlist', label: 'Allowlist', icon: MailCheck, count: allowlist.length },
          { id: 'spend', label: 'Spend', icon: Gauge, count: spend?.dailyByUser.length ?? 0 },
        ] as const).map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors cursor-pointer border-none ${
                active
                  ? 'bg-purple-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <Icon size={14} />
              {t.label} ({t.count})
            </button>
          )
        })}
      </div>

      {tab === 'users' && (
        <UsersTab
          users={users}
          loading={usersLoading}
          error={usersError}
          onRestore={restoreUser}
          onRetry={fetchUsers}
        />
      )}
      {tab === 'books' && (
        <BooksTab
          books={books}
          loading={booksLoading}
          error={booksError}
          onRestore={restoreBook}
          onToggleFeatured={toggleFeatured}
          onRetry={fetchBooks}
        />
      )}
      {tab === 'spend' && (
        <SpendTab data={spend} loading={spendLoading} error={spendError} onRetry={fetchSpend} />
      )}
      {tab === 'allowlist' && (
        <AllowlistTab
          entries={allowlist}
          loading={allowlistLoading}
          error={allowlistError}
          addError={allowlistAddError}
          adding={allowlistAdding}
          removingByEmail={allowlistRemoving}
          onRetry={fetchAllowlist}
          onAdd={addAllowedEmail}
          onRemove={removeAllowedEmail}
        />
      )}
      {tab === 'orphans' && (
        <OrphansTab
          orphans={orphans}
          loading={orphansLoading}
          error={orphansError}
          onRetry={fetchOrphans}
          onDelete={deleteOrphan}
          deletingById={orphanDeleting}
          errorById={orphanRowError}
        />
      )}
    </div>
  )
}

function LoadingRow({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm py-6 px-4">
      <Loader2 size={16} className="animate-spin" />
      {message}
    </div>
  )
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 rounded-xl">
      <div className="flex items-center gap-2">
        <AlertCircle size={16} />
        <span className="text-sm">{message}</span>
      </div>
      <button
        onClick={onRetry}
        className="text-sm font-semibold underline cursor-pointer bg-transparent border-none text-red-700 dark:text-red-300"
      >
        Try again
      </button>
    </div>
  )
}

interface UsersTabProps {
  users: AdminUser[]
  loading: boolean
  error: string
  onRestore: (id: string) => void
  onRetry: () => void
}

function UsersTab({ users, loading, error, onRestore, onRetry }: UsersTabProps) {
  if (loading) return <LoadingRow message="Loading users..." />
  if (error) return <ErrorRow message={error} onRetry={() => void onRetry()} />
  if (users.length === 0) {
    return <p className="text-gray-500 dark:text-gray-400 text-sm py-6 px-4">No users yet.</p>
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
          <tr className="text-left text-gray-600 dark:text-gray-300">
            <th className="px-4 py-3 font-semibold">Email</th>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Role</th>
            <th className="px-4 py-3 font-semibold">Created</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {users.map(u => {
            const isDeleted = u.deleted_at !== null
            return (
              <tr key={u.id} className="text-gray-700 dark:text-gray-200">
                <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-3">{u.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                      u.role === 'admin'
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatRelativeTime(u.created_at)}</td>
                <td className="px-4 py-3">
                  {isDeleted ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                      Deleted {formatRelativeTime(u.deleted_at!)}
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {isDeleted && (
                    <button
                      onClick={() => void onRestore(u.id)}
                      aria-label={`Restore user ${u.email}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 cursor-pointer border-none"
                    >
                      <RotateCcw size={12} />
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface BooksTabProps {
  books: AdminBook[]
  loading: boolean
  error: string
  onRestore: (id: string) => void
  onToggleFeatured: (book: AdminBook) => void
  onRetry: () => void
}

function BooksTab({ books, loading, error, onRestore, onToggleFeatured, onRetry }: BooksTabProps) {
  if (loading) return <LoadingRow message="Loading books..." />
  if (error) return <ErrorRow message={error} onRetry={() => void onRetry()} />
  if (books.length === 0) {
    return <p className="text-gray-500 dark:text-gray-400 text-sm py-6 px-4">No books yet.</p>
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
          <tr className="text-left text-gray-600 dark:text-gray-300">
            <th className="px-4 py-3 font-semibold">Title</th>
            <th className="px-4 py-3 font-semibold">Creator</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Featured</th>
            <th className="px-4 py-3 font-semibold">Deleted</th>
            <th className="px-4 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {books.map(b => {
            const isDeleted = b.deleted_at !== null
            const isFeatured = !!b.is_featured
            return (
              <tr key={b.id} className="text-gray-700 dark:text-gray-200">
                <td className="px-4 py-3">
                  <Link
                    to={`/book/${b.id}`}
                    className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 no-underline font-semibold"
                  >
                    {b.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                  {b.creator ? <span className="font-mono text-xs">{b.creator.email}</span> : <span>—</span>}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                      b.status === 'draft'
                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                        : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                    }`}
                  >
                    {b.status === 'draft' ? 'Draft' : 'Published'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void onToggleFeatured(b)}
                    aria-label={isFeatured ? `Unfeature ${b.title}` : `Feature ${b.title}`}
                    aria-pressed={isFeatured}
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer border-none transition-colors ${
                      isFeatured
                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-500 hover:bg-amber-200 dark:hover:bg-amber-900/60'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    <Star size={16} fill={isFeatured ? 'currentColor' : 'none'} />
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                  {isDeleted ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                      {formatRelativeTime(b.deleted_at!)}
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {isDeleted && (
                    <button
                      onClick={() => void onRestore(b.id)}
                      aria-label={`Restore book ${b.title}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 cursor-pointer border-none"
                    >
                      <RotateCcw size={12} />
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface OrphansTabProps {
  orphans: OrphanIllustration[]
  loading: boolean
  error: string
  onRetry: () => void
  onDelete: (orphan: OrphanIllustration) => void
  deletingById: Record<string, boolean>
  errorById: Record<string, string>
}

function OrphansTab({
  orphans,
  loading,
  error,
  onRetry,
  onDelete,
  deletingById,
  errorById,
}: OrphansTabProps) {
  if (loading) return <LoadingRow message="Loading orphan illustrations..." />
  if (error) return <ErrorRow message={error} onRetry={() => void onRetry()} />
  if (orphans.length === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm py-6 px-4">
        No orphaned illustration directories found.
      </p>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
          <tr className="text-left text-gray-600 dark:text-gray-300">
            <th className="px-4 py-3 font-semibold">Path</th>
            <th className="px-4 py-3 font-semibold">Book row</th>
            <th className="px-4 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {orphans.map(o => {
            let label = 'Missing'
            let tone = 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
            if (o.book_exists && o.soft_deleted) {
              label = 'Exists (soft-deleted)'
              tone = 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
            } else if (o.book_exists) {
              label = 'Exists'
              tone = 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
            }
            const id = orphanIdFromPath(o.path)
            const isDeleting = !!deletingById[id]
            const rowError = errorById[id]
            return (
              <tr key={o.path} className="text-gray-700 dark:text-gray-200">
                <td className="px-4 py-3 font-mono text-xs break-all">{o.path}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${tone}`}>{label}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void onDelete(o)}
                      disabled={isDeleting}
                      aria-label={`Delete orphan ${id}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400 text-white cursor-pointer border-none disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 size={12} />
                          Delete
                        </>
                      )}
                    </button>
                    {rowError && (
                      <span
                        role="alert"
                        className="text-xs text-red-700 dark:text-red-300 flex items-center gap-1"
                      >
                        <AlertCircle size={12} />
                        {rowError}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface AllowlistTabProps {
  entries: AllowedEmail[]
  loading: boolean
  error: string
  addError: string
  adding: boolean
  removingByEmail: Record<string, boolean>
  onRetry: () => Promise<void>
  onAdd: (email: string, note: string) => Promise<void>
  onRemove: (email: string) => Promise<void>
}

function AllowlistTab({
  entries,
  loading,
  error,
  addError,
  adding,
  removingByEmail,
  onRetry,
  onAdd,
  onRemove,
}: AllowlistTabProps) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    try {
      await onAdd(email.trim(), note)
      setEmail('')
      setNote('')
    } catch {
      // onAdd surfaces the message via addError; keep the inputs so the admin
      // can correct a typo rather than retyping the whole address.
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-5">
        <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-1">Invite an email</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Registration is closed by default. Only addresses on this list can create an account.
          Removing an address here does not disable an account that already exists — soft-delete
          the user for that.
        </p>
        <form onSubmit={e => void submit(e)} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="person@example.com"
            aria-label="Email to allow"
            required
            className="flex-1 px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            maxLength={200}
            className="flex-1 px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          <button
            type="submit"
            disabled={adding || !email.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-purple-500 hover:bg-purple-600 text-white cursor-pointer border-none disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </form>
        {addError && (
          <p className="flex items-center gap-1.5 mt-3 text-sm text-red-600 dark:text-red-400">
            <AlertCircle size={14} />
            {addError}
          </p>
        )}
      </div>

      {loading ? (
        <LoadingRow message="Loading allowlist..." />
      ) : error ? (
        <ErrorRow message={error} onRetry={() => void onRetry()} />
      ) : entries.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm py-6 px-4">
          Nobody is allowlisted yet — no new accounts can be created.
        </p>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
              <tr className="text-left text-gray-600 dark:text-gray-300">
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Note</th>
                <th className="px-4 py-3 font-semibold">Added by</th>
                <th className="px-4 py-3 font-semibold">Added</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {entries.map(entry => {
                const isRemoving = !!removingByEmail[entry.email]
                return (
                  <tr key={entry.email} className="text-gray-700 dark:text-gray-200">
                    <td className="px-4 py-3 font-mono text-xs break-all">{entry.email}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{entry.note || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{entry.added_by || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {formatRelativeTime(String(entry.created_at))}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void onRemove(entry.email)}
                        disabled={isRemoving}
                        aria-label={`Remove ${entry.email} from the allowlist`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400 text-white cursor-pointer border-none disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isRemoving ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

interface SpendTabProps {
  data: AdminSpendResponse | null
  loading: boolean
  error: string
  onRetry: () => Promise<void>
}

function SpendTab({ data, loading, error, onRetry }: SpendTabProps) {
  if (loading) return <LoadingRow message="Loading spend..." />
  if (error) return <ErrorRow message={error} onRetry={() => void onRetry()} />
  if (!data) return null

  const monthlyPct =
    data.monthlyLimitCents > 0
      ? Math.min(100, Math.round((data.monthlyTotalCents / data.monthlyLimitCents) * 100))
      : 0
  // Colour tracks headroom, not just a number, so the state reads at a glance.
  const barTone =
    monthlyPct >= 90
      ? 'bg-red-500 dark:bg-red-400'
      : monthlyPct >= 70
        ? 'bg-amber-500 dark:bg-amber-400'
        : 'bg-green-500 dark:bg-green-400'

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-gray-800 dark:text-gray-100">This month</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
            {formatCents(data.monthlyTotalCents)} of {formatCents(data.monthlyLimitCents)} ({monthlyPct}%)
          </p>
        </div>
        <div
          className="mt-3 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden"
          role="progressbar"
          aria-valuenow={monthlyPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Monthly spend against the ceiling"
        >
          <div className={`h-full ${barTone}`} style={{ width: `${monthlyPct}%` }} />
        </div>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Generation pauses for everyone — admins included — once the monthly ceiling is reached.
          The per-user daily cap is {formatCents(data.dailyLimitCents)}
          {data.adminBypassEnabled ? ', which admins may exceed.' : ', which nobody may exceed.'}
        </p>
      </div>

      {data.dailyByUser.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm py-6 px-4">
          No AI spend recorded today.
        </p>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
              <tr className="text-left text-gray-600 dark:text-gray-300">
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Spent today</th>
                <th className="px-4 py-3 font-semibold">Daily cap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.dailyByUser.map(row => {
                const atCap = row.spent_cents >= data.dailyLimitCents
                return (
                  <tr key={row.user_id} className="text-gray-700 dark:text-gray-200">
                    <td className="px-4 py-3">
                      {row.email ?? <span className="text-gray-400 dark:text-gray-500">(deleted user)</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span
                        className={
                          atCap
                            ? 'font-bold text-red-600 dark:text-red-400'
                            : 'text-gray-700 dark:text-gray-200'
                        }
                      >
                        {formatCents(row.spent_cents)}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-gray-400">
                      {formatCents(data.dailyLimitCents)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
