import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { CheckCircle, BookOpen, Download, Loader2, LogIn } from 'lucide-react'
import { api } from '../lib/apiBase'
import { useAuth } from '../context/AuthContext'
import { downloadBookPdf, PdfDownloadError } from '../lib/bookPdf'
import type { LoginLocationState } from '../lib/authFetch'
import type { Order } from '../types'

// Per-book state of the "keep a copy" download (#87). Keyed by book_id.
type PdfState = 'idle' | 'busy' | 'unavailable' | 'failed'

export default function OrderConfirmation() {
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const { user, loading: authLoading } = useAuth()
  const [pdfState, setPdfState] = useState<Record<string, PdfState>>({})

  const handleDownloadPdf = async (bookId: string, title: string): Promise<void> => {
    if (!user) return
    setPdfState(prev => ({ ...prev, [bookId]: 'busy' }))
    try {
      await downloadBookPdf(user.token, bookId, title)
      setPdfState(prev => ({ ...prev, [bookId]: 'idle' }))
    } catch (err: unknown) {
      // 404 means the book was withdrawn (or unpublished) since checkout. Say
      // so calmly rather than as an error: nothing the buyer did went wrong.
      const unavailable = err instanceof PdfDownloadError && err.status === 404
      setPdfState(prev => ({ ...prev, [bookId]: unavailable ? 'unavailable' : 'failed' }))
    }
  }

  useEffect(() => {
    fetch(api(`/api/orders/${id}`))
      .then(r => r.json())
      .then((data: Order) => { setOrder(data); setLoading(false) })
  }, [id])

  if (loading) return <div className="text-center py-20 text-gray-400 text-lg">Loading...</div>
  if (!order) return <div className="text-center py-20 text-gray-400 text-lg">Order not found</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 text-center">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-10 transition-colors">
        <CheckCircle size={64} className="text-green-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">Order Confirmed!</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Thank you, {order.customer_name}! Your magical books are on their way.
        </p>

        <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-6 text-left mb-6">
          <div className="text-sm text-green-600 dark:text-green-400 font-semibold mb-3">Order #{order.id.slice(0, 8)}</div>
          <div className="space-y-2">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">{item.title} x{item.quantity}</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <hr className="my-3 border-green-200 dark:border-green-800" />
          <div className="flex justify-between font-bold text-gray-800 dark:text-gray-100">
            <span>Total</span>
            <span>${order.total.toFixed(2)}</span>
          </div>
        </div>

        {/* #87: prompt the durable copy at the moment of purchase. The PDF route
            is signed-in only, so guests get a sign-in link that returns here
            rather than a button that would fail. */}
        {!authLoading && order.items.length > 0 && (
          <div
            data-testid="keep-a-copy"
            className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-6 text-left mb-6"
          >
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              Download a copy to keep. Your PDF stays yours even if the author updates the book later.
            </p>
            {user ? (
              <ul className="space-y-3">
                {order.items.map(item => {
                  const state = pdfState[item.book_id] ?? 'idle'
                  return (
                    <li key={item.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{item.title}</span>
                      <div className="flex flex-col sm:items-end gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDownloadPdf(item.book_id, item.title)}
                          disabled={state === 'busy' || state === 'unavailable'}
                          aria-label={`Download PDF of ${item.title}`}
                          className="inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 rounded-xl font-bold border-2 border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:focus-visible:ring-amber-500 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                        >
                          {state === 'busy'
                            ? <Loader2 size={18} className="animate-spin text-amber-700 dark:text-amber-300" />
                            : <Download size={18} />}
                          {state === 'busy' ? 'Preparing...' : 'Download PDF'}
                        </button>
                        {state === 'unavailable' && (
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            This book isn't available to download right now.
                          </span>
                        )}
                        {state === 'failed' && (
                          <span className="text-sm text-red-500 dark:text-red-400">
                            Download didn't work. Please try again.
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Link
                to="/login"
                state={{ from: `/order/${order.id}` } satisfies LoginLocationState}
                className="inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 rounded-xl font-bold border-2 border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 no-underline transition-colors"
              >
                <LogIn size={18} />
                Sign in to download your PDF
              </Link>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-xl font-bold no-underline transition-colors"
          >
            <BookOpen size={18} />
            Continue Browsing
          </Link>
          <Link
            to="/create"
            className="inline-flex items-center justify-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-xl font-bold no-underline transition-colors"
          >
            Create Another Book
          </Link>
        </div>
      </div>
    </div>
  )
}
