import { useState, useEffect, useCallback } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Shield, Users, BookOpen, FolderOpen, Loader2, RotateCcw, Star, AlertCircle, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { AdminUser, AdminBook, OrphanIllustration } from '../types'

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

type Tab = 'users' | 'books' | 'orphans'

export default function Admin() {
  const { user, loading: authLoading } = useAuth()
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

  const token = user?.token

  const fetchUsers = useCallback(async () => {
    if (!token) return
    setUsersLoading(true)
    setUsersError('')
    try {
      const res = await fetch('/api/admin/users', {
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
      const res = await fetch('/api/admin/books', {
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
      const res = await fetch('/api/admin/orphan-illustrations', {
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

  useEffect(() => {
    if (!token) return
    void fetchUsers()
    void fetchBooks()
    void fetchOrphans()
  }, [token, fetchUsers, fetchBooks, fetchOrphans])

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
      const res = await fetch(`/api/admin/users/${id}/restore`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        window.alert("Couldn't restore that user. Refresh to see the latest state.")
        return
      }
      const updated = (await res.json()) as AdminUser
      setUsers(prev => prev.map(u => (u.id === updated.id ? { ...u, ...updated } : u)))
    } catch {
      window.alert("Couldn't restore that user. Check your connection and try again.")
    }
  }

  const restoreBook = async (id: string) => {
    if (!token) return
    if (!window.confirm('Restore this book? It will reappear in the catalog.')) return
    try {
      const res = await fetch(`/api/admin/books/${id}/restore`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        window.alert("Couldn't restore that book. Refresh to see the latest state.")
        return
      }
      const updated = (await res.json()) as AdminBook
      setBooks(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)))
    } catch {
      window.alert("Couldn't restore that book. Check your connection and try again.")
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
      const res = await fetch(`/api/admin/orphan-illustrations/${encodeURIComponent(id)}`, {
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
      const res = await fetch(`/api/admin/books/${book.id}/featured`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_featured: next }),
      })
      if (!res.ok) {
        window.alert("Couldn't update featured state. Refresh to see the latest state.")
        return
      }
      const updated = (await res.json()) as AdminBook
      setBooks(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)))
    } catch {
      window.alert("Couldn't update featured state. Check your connection and try again.")
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
