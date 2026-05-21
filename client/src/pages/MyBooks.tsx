import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Sparkles, Send, Trash2, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { Book, BookWithPages } from '../types'

type MyBook = Book & Partial<Pick<BookWithPages, 'pages'>>

export default function MyBooks() {
  const { user } = useAuth()
  const [books, setBooks] = useState<MyBook[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'all' | 'draft' | 'published'>('all')
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null)

  const fetchBooks = useCallback(() => {
    if (!user) return
    fetch('/api/books/mine', {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(res => res.json())
      .then((data: MyBook[]) => setBooks(data))
      .catch(() => setBooks([]))
      .finally(() => setLoading(false))
  }, [user])

  useEffect(() => { fetchBooks() }, [fetchBooks])

  const publishBook = async (bookId: string) => {
    if (!user) return
    const res = await fetch(`/api/books/${bookId}/publish`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${user.token}` },
    })
    if (res.ok) fetchBooks()
  }

  const unpublishBook = async (bookId: string) => {
    if (!user) return
    const ok = window.confirm(
      'Unpublish this book? It will be removed from the public catalog but kept as a draft you can keep editing.'
    )
    if (!ok) return
    setUnpublishingId(bookId)
    try {
      const res = await fetch(`/api/books/${bookId}/unpublish`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${user.token}` },
      })
      if (res.ok) {
        const updated = (await res.json()) as MyBook
        setBooks(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)))
      } else {
        window.alert("Couldn't unpublish that book. It may already be a draft — refresh to see the latest state.")
      }
    } catch {
      window.alert("Couldn't unpublish that book. Check your connection and try again.")
    } finally {
      setUnpublishingId(null)
    }
  }

  const deleteBook = async (bookId: string) => {
    if (!user) return
    const res = await fetch(`/api/books/${bookId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${user.token}` },
    })
    if (res.ok) fetchBooks()
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <BookOpen size={64} className="text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">Sign in to see your books</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">Create an account to track all the stories you create.</p>
        <Link
          to="/login"
          className="inline-block bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-xl font-bold no-underline transition-colors"
        >
          Sign In
        </Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="animate-pulse text-gray-400 dark:text-gray-500 text-lg">Loading your books...</div>
      </div>
    )
  }

  if (books.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Sparkles size={64} className="text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">No books yet</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">Create your first personalized story with AI!</p>
        <Link
          to="/create"
          className="inline-block bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-xl font-bold no-underline transition-shadow hover:shadow-lg"
        >
          Create a Book
        </Link>
      </div>
    )
  }

  const filtered = tab === 'all' ? books : books.filter(b => b.status === tab)
  const draftCount = books.filter(b => b.status === 'draft').length
  const publishedCount = books.filter(b => b.status === 'published').length

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display">My Books</h1>
        <Link
          to="/create"
          className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-full flex items-center gap-1.5 no-underline font-semibold hover:shadow-lg transition-shadow text-sm"
        >
          <Sparkles size={16} />
          Create Another
        </Link>
      </div>

      <div className="flex gap-2 mb-6">
        {(['all', 'draft', 'published'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors cursor-pointer border-none ${
              tab === t
                ? 'bg-purple-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {t === 'all' ? `All (${books.length})` : t === 'draft' ? `Drafts (${draftCount})` : `Published (${publishedCount})`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(book => (
          <div key={book.id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden group">
            <Link to={`/book/${book.id}`} className="no-underline">
              <div
                className="h-48 flex items-center justify-center text-7xl transition-transform duration-300 group-hover:scale-105 relative"
                style={{ backgroundColor: book.cover_color + '20' }}
              >
                <span className="drop-shadow-lg">{book.cover_emoji}</span>
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  {book.status === 'draft' && book.pages && book.pages.length > 0 && (() => {
                    const unillustrated = book.pages.filter(p => !p.illustration_url).length
                    if (unillustrated === 0) return null
                    return (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {unillustrated} unillustrated
                      </span>
                    )
                  })()}
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    book.status === 'draft'
                      ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                      : 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
                  }`}>
                    {book.status === 'draft' ? 'Draft' : 'Published'}
                  </span>
                </div>
              </div>
            </Link>
            <div className="p-4">
              <Link to={`/book/${book.id}`} className="no-underline">
                <h3 className="font-display text-lg font-bold text-gray-800 dark:text-gray-100 mb-1 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                  {book.title}
                </h3>
              </Link>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-3 line-clamp-2">{book.description}</p>
              <div className="flex items-center gap-2">
                {book.status === 'draft' && (
                  <button
                    onClick={() => void publishBook(book.id)}
                    aria-label="Publish book"
                    className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer border-none"
                  >
                    <Send size={14} />
                    Publish
                  </button>
                )}
                {book.status === 'published' && (
                  <button
                    onClick={() => void unpublishBook(book.id)}
                    disabled={unpublishingId === book.id}
                    aria-label="Unpublish book"
                    className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer border border-gray-200 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <EyeOff size={14} />
                    {unpublishingId === book.id ? 'Unpublishing...' : 'Unpublish'}
                  </button>
                )}
                <button
                  onClick={() => void deleteBook(book.id)}
                  aria-label="Delete book"
                  className="flex items-center gap-1.5 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer border-none"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
