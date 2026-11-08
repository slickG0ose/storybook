import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useTheme } from '../context/ThemeContext'
import { buildFeedbackContext, submitFeedback, FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX } from '../lib/feedback'
import { getRecentErrors } from '../lib/recentErrors'
import type { FeedbackCategory } from '../types'

interface FeedbackDialogProps {
  open: boolean
  onClose: () => void
}

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  idea: 'Idea',
  praise: 'Praise',
  other: 'Other',
}

const GENERIC_FAILURE = "Couldn't send that. Your message is still here — try again."
const AUTH_FAILURE = 'Your session has ended — sign in again, then send.'

export default function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
  const { user } = useAuth()
  const { sessionId } = useCart()
  const { dark } = useTheme()
  const location = useLocation()
  const headingId = useId()

  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // The element that had focus when the dialog opened (the Navbar trigger), so
  // focus can go back to it on close.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const trimmed = message.trim()
  const canSend = trimmed.length > 0 && !submitting

  const handleClose = () => {
    // A sent report is done with; an unsent draft is kept for the next open.
    if (sent) {
      setSent(false)
      setMessage('')
      setCategory('bug')
    }
    setError(null)
    onClose()
  }

  // Escape goes through the same path as the close button. Held in a ref so the
  // open effect below does not re-run (and bounce focus) on every render.
  const closeHandlerRef = useRef(handleClose)
  useEffect(() => {
    closeHandlerRef.current = handleClose
  })

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    textareaRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHandlerRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    if (!user) {
      setError(AUTH_FAILURE)
      return
    }
    setSubmitting(true)
    setError(null)
    const context = buildFeedbackContext({
      pathname: location.pathname,
      search: location.search,
      dark,
      sessionId,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      build: import.meta.env.VITE_APP_COMMIT,
      recentErrors: getRecentErrors(),
    })
    const result = await submitFeedback(user.token, { ...context, category, message: trimmed })
    setSubmitting(false)
    if (result.ok) {
      setSent(true)
      return
    }
    setError(
      result.kind === 'auth' ? AUTH_FAILURE : result.kind === 'rate' ? result.message : GENERIC_FAILURE,
    )
  }

  const sendAnother = () => {
    setSent(false)
    setMessage('')
    setCategory('bug')
    setError(null)
    // The textarea mounts again on the next render.
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-3xl shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id={headingId} className="text-lg font-bold text-gray-800 dark:text-gray-100 font-display">
            Send feedback
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close feedback"
            className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:focus-visible:outline-indigo-400 cursor-pointer border-none bg-transparent"
          >
            <X size={18} />
          </button>
        </div>

        {sent ? (
          <div className="px-5 py-6 space-y-5">
            <p role="status" className="text-base text-gray-700 dark:text-gray-200">
              Thanks — that's been sent.
            </p>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={sendAnother}
                className="min-h-11 px-4 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:focus-visible:outline-indigo-400 font-semibold cursor-pointer"
              >
                Send another
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="min-h-11 px-4 rounded-xl border-none bg-indigo-600 dark:bg-indigo-500 text-white dark:text-white hover:bg-indigo-700 dark:hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:focus-visible:outline-indigo-300 font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
            <div
              role="radiogroup"
              aria-label="Feedback type"
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
            >
              {FEEDBACK_CATEGORIES.map(c => {
                const checked = c === category
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setCategory(c)}
                    className={`min-h-11 px-3 rounded-xl border text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-indigo-500 dark:focus-visible:outline-indigo-400 ${
                      checked
                        ? 'bg-indigo-600 dark:bg-indigo-500 border-indigo-600 dark:border-indigo-500 text-white dark:text-white'
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                )
              })}
            </div>

            <div>
              <textarea
                ref={textareaRef}
                aria-label="Your feedback"
                value={message}
                maxLength={FEEDBACK_MESSAGE_MAX}
                onChange={e => setMessage(e.target.value)}
                rows={5}
                placeholder="What happened, or what would you like?"
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 p-3 text-base focus:outline-2 focus:outline-indigo-500 dark:focus:outline-indigo-400 resize-y"
              />
              <div className="mt-1 text-right text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
                {message.length} / {FEEDBACK_MESSAGE_MAX}
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Your account, the page you're on, and your screen size are attached so we can follow up.
            </p>

            {error && (
              <p
                role="alert"
                className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl text-sm"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!canSend}
                className="min-h-11 px-5 rounded-xl border-none bg-indigo-600 dark:bg-indigo-500 text-white dark:text-white hover:bg-indigo-700 dark:hover:bg-indigo-400 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:text-gray-500 dark:disabled:text-gray-400 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-indigo-500 dark:focus-visible:outline-indigo-300 font-semibold cursor-pointer"
              >
                {submitting ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
