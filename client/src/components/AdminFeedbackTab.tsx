// Admin Feedback tab (spec: .code-captain/specs/tester-feedback-widget/, Task 7).
// Presentational only: every network call lives in pages/Admin.tsx, which owns
// /api/admin/*. Cards rather than a table at every width — Nick triages from a phone,
// and the existing admin tables are not built for 393px.
import { Link } from 'react-router-dom'
import { AlertCircle, Loader2, X } from 'lucide-react'
import type { AdminFeedbackItem, FeedbackCategory, FeedbackStatus } from '../types'

export type FeedbackStatusFilter = FeedbackStatus | 'all'
export interface FeedbackUserFilter {
  id: string
  email: string
}

export interface AdminFeedbackTabProps {
  items: AdminFeedbackItem[]
  loading: boolean
  error: string | null
  statusFilter: FeedbackStatusFilter
  onStatusFilter: (s: FeedbackStatusFilter) => void
  userFilter: FeedbackUserFilter | null
  onUserFilter: (u: FeedbackUserFilter | null) => void
  onStatusChange: (id: string, status: FeedbackStatus) => void
  savingIds: Record<string, boolean>
  onRetry: () => void
}

const STATUS_FILTERS: { id: FeedbackStatusFilter; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'triaged', label: 'Triaged' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
]

const STATUS_OPTIONS: { id: FeedbackStatus; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'triaged', label: 'Triaged' },
  { id: 'done', label: 'Done' },
]

const CATEGORY_STYLE: Record<FeedbackCategory, { label: string; tone: string }> = {
  bug: { label: 'Bug', tone: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
  idea: { label: 'Idea', tone: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  praise: { label: 'Praise', tone: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  other: { label: 'Other', tone: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
}

const EMPTY_MESSAGE: Record<FeedbackStatusFilter, string> = {
  new: 'No new feedback. Nothing waiting on you.',
  triaged: 'No triaged feedback.',
  done: 'No feedback marked done yet.',
  all: 'No feedback yet.',
}

function formatLocal(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function feedbackContextLine(item: AdminFeedbackItem): string {
  const client = item.client_build?.slice(0, 7) ?? 'dev'
  const server = item.server_build?.slice(0, 7) ?? '—'
  return `${item.theme} · ${item.viewport_width}×${item.viewport_height} · client ${client} · server ${server}`
}

export default function AdminFeedbackTab({
  items,
  loading,
  error,
  statusFilter,
  onStatusFilter,
  userFilter,
  onUserFilter,
  onStatusChange,
  savingIds,
  onRetry,
}: AdminFeedbackTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter feedback by status">
        {STATUS_FILTERS.map(f => {
          const active = statusFilter === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onStatusFilter(f.id)}
              aria-pressed={active}
              className={`min-h-11 px-4 rounded-full text-sm font-semibold cursor-pointer border-none transition-colors focus-visible:outline-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400 ${
                active
                  ? 'bg-purple-500 dark:bg-purple-500 text-white dark:text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {userFilter && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span>Showing feedback from</span>
          <span className="inline-flex items-center gap-1 max-w-full rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 pl-3 font-semibold">
            <span className="break-all">{userFilter.email}</span>
            <button
              type="button"
              onClick={() => onUserFilter(null)}
              aria-label={`Clear filter for ${userFilter.email}`}
              className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full bg-transparent border-none cursor-pointer text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 focus-visible:outline-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400"
            >
              <X size={14} />
            </button>
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm py-6 px-4">
          <Loader2 size={16} className="animate-spin" />
          Loading feedback...
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 rounded-xl">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} />
            <span className="text-sm">{error}</span>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 text-sm font-semibold underline cursor-pointer bg-transparent border-none text-red-700 dark:text-red-300"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm py-6 px-4">
          {EMPTY_MESSAGE[statusFilter]}
          {userFilter ? ` (for ${userFilter.email})` : ''}
        </p>
      ) : (
        <ul className="space-y-3 list-none p-0 m-0">
          {items.map(item => (
            <FeedbackCard
              key={item.id}
              item={item}
              saving={!!savingIds[item.id]}
              onStatusChange={onStatusChange}
              onUserFilter={onUserFilter}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FeedbackCard({
  item,
  saving,
  onStatusChange,
  onUserFilter,
}: {
  item: AdminFeedbackItem
  saving: boolean
  onStatusChange: (id: string, status: FeedbackStatus) => void
  onUserFilter: (u: FeedbackUserFilter) => void
}) {
  const category = CATEGORY_STYLE[item.category]
  const errorCount = item.recent_errors.length
  return (
    <li
      className="min-w-0 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-2xl shadow-md p-4 space-y-3"
      data-testid="feedback-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${category.tone}`}>
            {category.label}
          </span>
          <time dateTime={item.created_at} className="text-xs text-gray-500 dark:text-gray-400">
            {formatLocal(item.created_at)}
          </time>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 size={14} className="animate-spin text-gray-400 dark:text-gray-500" aria-hidden="true" />}
          <select
            aria-label={`Status for feedback from ${item.user_email}`}
            value={item.status}
            disabled={saving}
            onChange={e => onStatusChange(item.id, e.target.value as FeedbackStatus)}
            className="min-h-11 px-3 rounded-lg text-sm font-semibold bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onUserFilter({ id: item.user_id, email: item.user_email })}
        aria-label={`Show only feedback from ${item.user_email}`}
        className="min-h-11 max-w-full text-left bg-transparent border-none p-0 cursor-pointer text-sm text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 focus-visible:outline-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400"
      >
        <span className="font-mono text-xs break-all">{item.user_email}</span>{' '}
        <span className="text-gray-500 dark:text-gray-400">({item.user_name})</span>
      </button>

      <p className="text-sm whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">{item.message}</p>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-gray-500 dark:text-gray-400">Route</dt>
        <dd className="m-0 min-w-0">
          <Link
            to={item.route}
            className="break-all font-mono text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300"
          >
            {item.route}
          </Link>
        </dd>
        {item.book_title && (
          <>
            <dt className="text-gray-500 dark:text-gray-400">Book</dt>
            <dd className="m-0 min-w-0 break-words text-gray-700 dark:text-gray-200">{item.book_title}</dd>
          </>
        )}
        <dt className="text-gray-500 dark:text-gray-400">Context</dt>
        <dd className="m-0 min-w-0 break-words text-gray-700 dark:text-gray-200">{feedbackContextLine(item)}</dd>
        <dt className="text-gray-500 dark:text-gray-400">Browser</dt>
        <dd
          className="m-0 min-w-0 truncate text-gray-700 dark:text-gray-200"
          title={item.user_agent ?? undefined}
        >
          {item.user_agent ?? '—'}
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">Session</dt>
        <dd className="m-0 min-w-0 font-mono text-gray-700 dark:text-gray-200" title={item.session_id}>
          {item.session_id.slice(0, 8)}
        </dd>
      </dl>

      {errorCount > 0 && (
        <details className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
          <summary className="min-h-11 flex items-center px-3 cursor-pointer text-xs font-semibold text-red-700 dark:text-red-300">
            {errorCount} recent {errorCount === 1 ? 'error' : 'errors'}
          </summary>
          <ul className="list-none m-0 px-3 pb-3 space-y-1">
            {item.recent_errors.map((err, i) => (
              <li
                key={i}
                className="font-mono text-xs whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300"
              >
                {err}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}
