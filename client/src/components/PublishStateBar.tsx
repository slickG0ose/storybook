import { useState } from 'react'
import { AlertTriangle, PencilLine, Send } from 'lucide-react'

/**
 * The author-facing publish-state surface for `/book/:id`.
 *
 * Owns both owner states of the "withdraw to edit" model (spec:
 * `.code-captain/specs/edit-published-books/spec.md`) so `BookDetail.tsx` — 1213 lines and
 * freshly touched by the read-aloud merge — receives a mount plus two handlers rather than a
 * banner, two confirms, and their state.
 *
 * **Presentational only.** It holds no fetch logic, reads no `localStorage`, and knows nothing
 * about routes: the caller passes the state and receives `onWithdraw` / `onPublish` callbacks.
 *
 * **The confirmations are inline panels, not modals and not `window.confirm`.** This follows
 * ADR-004 decision 2's no-overlay precedent: a modal would drag in the whole modal contract
 * (focus trap, escape-to-close, scroll lock, `aria-modal`, a portal) for two buttons, and
 * `window.confirm` cannot honour dark mode, cannot be tap-target asserted, and needs
 * `page.on('dialog')` in Playwright.
 *
 * **The publish-time unillustrated confirm is client-side only.** The server deliberately does
 * not block publishing a text-only book — the seed catalog contains them and `renderBookPdf`
 * handles them (spec Open question 2). It is the second net under `POST /:id/revise`, which
 * nulls `illustration_url` on every changed page.
 *
 * Class strings are written out per element rather than hoisted into shared constants so that
 * every light class and its `dark:` partner sit in one literal string — which is exactly what
 * `dark-mode-parity-check` reads.
 */

export interface PublishStateBarProps {
  isOwner: boolean
  isDraft: boolean
  title: string
  pageCount: number
  unillustratedCount: number
  /** PUT /api/books/:id/unpublish. Resolves when the book is a draft. */
  onWithdraw: () => Promise<void>
  /** PUT /api/books/:id/publish. */
  onPublish: () => Promise<void>
  busy?: boolean
  error?: string
}

/**
 * One slot, so "exactly one confirm can be open at a time" is structural rather than an
 * invariant two booleans have to be kept honest about.
 */
type OpenConfirm = 'withdraw' | 'publish' | null

export default function PublishStateBar({
  isOwner,
  isDraft,
  title,
  pageCount,
  unillustratedCount,
  onWithdraw,
  onPublish,
  busy = false,
  error,
}: PublishStateBarProps) {
  const [openConfirm, setOpenConfirm] = useState<OpenConfirm>(null)

  // A reader is told nothing about publish state — not even that the concept exists.
  if (!isOwner) return null

  const errorNode = error ? (
    <p
      role="alert"
      data-testid="publish-state-error"
      className="mt-3 flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400"
    >
      <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
      {error}
    </p>
  ) : null

  if (!isDraft) {
    const confirmOpen = openConfirm === 'withdraw'

    return (
      <section
        aria-label="Publish state"
        data-testid="publish-state-bar"
        className="mb-8 rounded-3xl border border-purple-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm shadow-purple-900/5 dark:shadow-black/30 transition-colors"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display font-bold text-gray-800 dark:text-gray-100">In the catalog</p>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
              Readers can find and buy this book. Editing it means taking it out first.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpenConfirm(confirmOpen ? null : 'withdraw')}
            disabled={busy}
            aria-expanded={confirmOpen}
            aria-controls="withdraw-confirm"
            className="min-h-11 inline-flex items-center gap-2 rounded-xl border-none px-5 font-bold bg-purple-600 dark:bg-purple-600 text-white dark:text-white hover:bg-purple-700 dark:hover:bg-purple-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-purple-600 dark:disabled:hover:bg-purple-600 transition-colors cursor-pointer"
          >
            <PencilLine size={16} aria-hidden="true" />
            Edit this book
          </button>
        </div>

        {confirmOpen && (
          <div
            id="withdraw-confirm"
            data-testid="withdraw-confirm"
            className="mt-4 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-4 transition-colors"
          >
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Editing takes <strong className="font-bold text-amber-900 dark:text-amber-100">{title}</strong> out of the
              catalog while you work. Readers won&rsquo;t be able to find or buy it until you publish again. Anyone who
              already bought it keeps their receipt.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onWithdraw()}
                disabled={busy}
                className="min-h-11 inline-flex items-center gap-2 rounded-xl border-none px-5 font-bold bg-purple-600 dark:bg-purple-600 text-white dark:text-white hover:bg-purple-700 dark:hover:bg-purple-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-purple-600 dark:disabled:hover:bg-purple-600 transition-colors cursor-pointer"
              >
                Take it out and edit
              </button>
              <button
                type="button"
                onClick={() => setOpenConfirm(null)}
                disabled={busy}
                className="min-h-11 inline-flex items-center rounded-xl border border-gray-300 dark:border-gray-600 px-5 font-semibold bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white dark:disabled:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {errorNode}
      </section>
    )
  }

  const confirmOpen = openConfirm === 'publish'
  // With no schema change there is no `published_at`, so a never-published draft and a
  // withdrawn one are indistinguishable here — the copy is status-driven and reads the same
  // for both (spec Open question 1).
  const summary =
    `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}` +
    (unillustratedCount > 0 ? ` · ${unillustratedCount} without an illustration` : '')

  const handlePublishClick = () => {
    if (unillustratedCount > 0) {
      setOpenConfirm(confirmOpen ? null : 'publish')
      return
    }
    void onPublish()
  }

  return (
    <section
      aria-label="Publish state"
      data-testid="publish-state-bar"
      className="mb-8 rounded-3xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-5 transition-colors"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display font-bold text-amber-900 dark:text-amber-200">Out of the catalog while you edit</p>
          <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">{summary}</p>
        </div>
        <button
          type="button"
          onClick={handlePublishClick}
          disabled={busy}
          aria-expanded={unillustratedCount > 0 ? confirmOpen : undefined}
          aria-controls={unillustratedCount > 0 ? 'publish-confirm' : undefined}
          className="min-h-11 inline-flex items-center gap-2 rounded-xl border-none px-5 font-bold bg-green-600 dark:bg-green-600 text-white dark:text-white hover:bg-green-700 dark:hover:bg-green-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 dark:focus-visible:outline-green-400 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-green-600 dark:disabled:hover:bg-green-600 transition-colors cursor-pointer"
        >
          <Send size={16} aria-hidden="true" />
          Publish changes
        </button>
      </div>

      {confirmOpen && (
        <div
          id="publish-confirm"
          data-testid="publish-confirm"
          className="mt-4 rounded-2xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 p-4 transition-colors"
        >
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {unillustratedCount} of {pageCount} pages have no illustration yet. Publish anyway?
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onPublish()}
              disabled={busy}
              className="min-h-11 inline-flex items-center gap-2 rounded-xl border-none px-5 font-bold bg-green-600 dark:bg-green-600 text-white dark:text-white hover:bg-green-700 dark:hover:bg-green-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 dark:focus-visible:outline-green-400 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-green-600 dark:disabled:hover:bg-green-600 transition-colors cursor-pointer"
            >
              Publish anyway
            </button>
            <button
              type="button"
              onClick={() => setOpenConfirm(null)}
              disabled={busy}
              className="min-h-11 inline-flex items-center rounded-xl border border-gray-300 dark:border-gray-600 px-5 font-semibold bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 dark:focus-visible:outline-green-400 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white dark:disabled:hover:bg-gray-700 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {errorNode}
    </section>
  )
}
