import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ShoppingCart, ChevronLeft, ChevronRight, Send, Loader2, RefreshCw, Paintbrush, Image, BookOpen, FileText, History, RotateCcw, CheckCircle2, X, GitCompare, Users } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/apiBase'
import { PER_IMAGE_COST_USD, fmtUsd, portraitStepCostNote } from '../lib/cost'
import type { BookWithPages, BookVersion, IllustrationVersion, Page } from '../types'
import BookSpread from '../components/BookSpread'

// A character "requires" a portrait (for the approve-cast soft gate) when its
// role is primary or antagonist — these are the identity-critical, recurring
// figures (spec "Required character" decision). Supporting characters get an
// optional Generate affordance but never block approval.
const isRequiredRole = (role: string): boolean =>
  role === 'primary' || role === 'antagonist'

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

// Defensive JSON parser. The illustration generator (and other long-running
// mutations) occasionally returns a non-2xx response with an empty body — when
// that happens, `await res.json()` throws the browser's raw "Unexpected end of
// JSON input" error string into the UI. Read text first, then attempt parse,
// so callers get either a parsed object, `null` (empty body), or a friendly
// error fallback they can surface to the user.
type ParsedJsonResult<T> = T | { error: string } | null
async function safeReadJson<T>(res: Response): Promise<ParsedJsonResult<T>> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    const status = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
    return { error: `Server returned ${status} with a non-JSON body` }
  }
}

// Build a user-facing error message for a non-2xx fetch response. Prefers the
// server's `error` field, falls back to a status-code message when the body
// is empty or non-JSON.
function errorMessageFromResponse(
  parsed: ParsedJsonResult<unknown>,
  res: Response,
  fallback: string
): string {
  if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string') {
    return (parsed as { error: string }).error
  }
  if (parsed === null) {
    const status = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
    return `Server returned ${status} with an empty response. Try again, or check the server logs.`
  }
  return fallback
}

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const theater = searchParams.get('theater') === '1'
  const toggleTheater = () => {
    const next = new URLSearchParams(searchParams)
    if (theater) next.delete('theater')
    else next.set('theater', '1')
    setSearchParams(next, { replace: false }) // back-button exits theater mode
  }
  const { addToCart } = useCart()
  const { user } = useAuth()
  const [book, setBook] = useState<BookWithPages | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [added, setAdded] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [revising, setRevising] = useState(false)
  const [reviseError, setReviseError] = useState('')
  const [illustrating, setIllustrating] = useState(false)
  const [illustrateError, setIllustrateError] = useState('')
  const [illustrationFeedback, setIllustrationFeedback] = useState('')
  const [illustrationVersions, setIllustrationVersions] = useState<IllustrationVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [viewMode, setViewMode] = useState<'spread' | 'reader'>('spread')
  const [versions, setVersions] = useState<BookVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null)
  const [restoreError, setRestoreError] = useState('')
  const [lastRevisedVersion, setLastRevisedVersion] = useState<number | null>(null)
  const [showDiffModal, setShowDiffModal] = useState(false)
  // Cast panel (IV2 Phase 2): per-character portrait feedback text, the index
  // currently generating, and a per-character error. Approve-cast is a local UI
  // flag only — NOT a persisted field (spec: no `cast_approved` column).
  const [portraitFeedback, setPortraitFeedback] = useState<Record<number, string>>({})
  const [generatingPortrait, setGeneratingPortrait] = useState<number | null>(null)
  const [portraitError, setPortraitError] = useState<Record<number, string>>({})
  const [skipPortraits, setSkipPortraits] = useState(false)

  const fetchBook = () => {
    const headers: Record<string, string> = {}
    if (user?.token) headers['Authorization'] = `Bearer ${user.token}`
    fetch(api(`/api/books/${id}`), { headers })
      .then(r => r.json())
      .then((data: BookWithPages) => { setBook(data); setLoading(false) })
  }

  useEffect(() => { fetchBook() }, [id, user])

  const fetchVersions = useCallback(async (bookId: string, token: string) => {
    setVersionsLoading(true)
    setVersionsError('')
    try {
      const res = await fetch(api(`/api/books/${bookId}/versions`), {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to load version history')
      }
      const data = await res.json() as BookVersion[]
      setVersions(data)
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : 'Failed to load version history')
    } finally {
      setVersionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!book || !user?.token) return
    const owner = book.created_by === user.id
    const draft = book.status === 'draft'
    if (owner && draft) {
      void fetchVersions(book.id, user.token)
    }
  }, [book, user, fetchVersions])

  if (loading) return <div className="text-center py-20 text-gray-400 text-lg">Loading...</div>
  if (!book) return <div className="text-center py-20 text-gray-400 text-lg">Book not found</div>

  const pages: Page[] = book.pages || []
  const page = pages[currentPage]
  const isOwner = user && book.created_by === user.id
  const isDraft = book.status === 'draft'

  // Approve-cast soft gate (IV2 Phase 2). Required characters (primary +
  // antagonist) must all have a portrait_url before the bulk Illustrate All
  // button is enabled — OR the user explicitly skips. This is encouraging, not
  // blocking: the skip path always re-enables illustration (the server falls
  // back to prompt-only when portraits are absent). An empty required set (e.g.
  // legacy books with no characters) counts as satisfied so illustration is
  // never gated away from books that predate the Cast panel.
  const cast = book.characters ?? []
  const requiredCharacters = cast.filter(c => isRequiredRole(c.role))
  const castApproved = requiredCharacters.every(c => !!c.portrait_url)
  const canBulkIllustrate = castApproved || skipPortraits

  // After a revise, the most-recent BookVersion row is the prior version's
  // snapshot — i.e. the state BEFORE the revise. versions[0] is newest first.
  const priorVersion: BookVersion | null =
    lastRevisedVersion === book.version && versions.length > 0 ? versions[0]! : null
  // Hide the banner if we expected a prior version but the fetch resolved
  // empty (nothing to compare against).
  const showRevisedBanner =
    lastRevisedVersion === book.version && (versionsLoading || versions.length > 0)
  const dismissBanner = () => {
    setLastRevisedVersion(null)
    setShowDiffModal(false)
  }

  // Build a side-by-side row list when the modal is open. Includes every page
  // number from either version so added/removed pages are surfaced.
  type DiffRow = {
    pageNumber: number
    oldText: string | null
    newText: string | null
    status: 'changed' | 'unchanged' | 'added' | 'removed'
  }
  const diffRows: DiffRow[] = (() => {
    if (!priorVersion) return []
    const oldByNum = new Map<number, string>()
    priorVersion.pages.forEach(p => oldByNum.set(p.page_number, p.text))
    const newByNum = new Map<number, string>()
    pages.forEach(p => newByNum.set(p.page_number, p.text))
    const allNums = Array.from(new Set([...oldByNum.keys(), ...newByNum.keys()])).sort((a, b) => a - b)
    return allNums.map(n => {
      const oldText = oldByNum.has(n) ? oldByNum.get(n)! : null
      const newText = newByNum.has(n) ? newByNum.get(n)! : null
      let status: DiffRow['status']
      if (oldText === null) status = 'added'
      else if (newText === null) status = 'removed'
      else if (oldText !== newText) status = 'changed'
      else status = 'unchanged'
      return { pageNumber: n, oldText, newText, status }
    })
  })()

  const handleAdd = async () => {
    await addToCart(book.id)
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  const handleRevise = async (feedbackText?: string, newPageCount?: number) => {
    const text = (feedbackText ?? feedback).trim()
    if (!text || !user) return
    setRevising(true)
    setReviseError('')
    try {
      const body: { feedback: string; newPageCount?: number } = { feedback: text }
      if (typeof newPageCount === 'number') body.newPageCount = newPageCount
      const res = await fetch(api(`/api/books/${book.id}/revise`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`,
        },
        body: JSON.stringify(body),
      })
      const parsed = await safeReadJson<BookWithPages>(res)
      if (!res.ok) {
        throw new Error(errorMessageFromResponse(parsed, res, 'Revision failed'))
      }
      if (parsed === null || (typeof parsed === 'object' && 'error' in parsed)) {
        throw new Error(errorMessageFromResponse(parsed, res, 'Revision failed'))
      }
      const updated = parsed
      setBook(updated)
      setFeedback('')
      setCurrentPage(0)
      setLastRevisedVersion(updated.version)
      setShowDiffModal(false)
      if (user.token) {
        void fetchVersions(updated.id, user.token)
      }
    } catch (err) {
      setReviseError(err instanceof Error ? err.message : 'Revision failed')
    } finally {
      setRevising(false)
    }
  }

  const handleRestore = async (version: number) => {
    if (!user) return
    const proceed = window.confirm(
      `Restore version ${version}? This replaces the current story text and illustration prompts. Illustrations on changed pages will be cleared and need to be regenerated.`
    )
    if (!proceed) return
    setRestoringVersion(version)
    setRestoreError('')
    try {
      const res = await fetch(api(`/api/books/${book.id}/versions/${version}/restore`), {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${user.token}` },
      })
      const parsed = await safeReadJson<BookWithPages>(res)
      if (!res.ok) {
        throw new Error(errorMessageFromResponse(parsed, res, 'Failed to restore version'))
      }
      if (parsed === null || (typeof parsed === 'object' && 'error' in parsed)) {
        throw new Error(errorMessageFromResponse(parsed, res, 'Failed to restore version'))
      }
      const updated = parsed
      setBook(updated)
      setCurrentPage(0)
      await fetchVersions(book.id, user.token)
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Failed to restore version')
    } finally {
      setRestoringVersion(null)
    }
  }

  const handlePublish = async () => {
    if (!user) return
    const res = await fetch(api(`/api/books/${book.id}/publish`), {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${user.token}` },
    })
    if (res.ok) {
      const updated = await res.json() as BookWithPages
      setBook({ ...book, ...updated })
    }
  }

  const handleEditPrompt = async (pageNumber: number, description: string): Promise<void> => {
    if (!user) return
    const res = await fetch(api(`/api/books/${book.id}/pages/${pageNumber}`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user.token}`,
      },
      body: JSON.stringify({ illustration_description: description }),
    })
    if (res.ok) {
      const updated = await res.json() as BookWithPages
      setBook(updated)
    }
  }

  const handleIllustrate = async (pageNum?: number) => {
    if (!user) return
    setIllustrating(true)
    setIllustrateError('')
    try {
      const body: Record<string, unknown> = {}
      if (pageNum) {
        body.pageNumber = pageNum
        if (illustrationFeedback.trim()) body.feedback = illustrationFeedback.trim()
      }
      const res = await fetch(api(`/api/books/${book.id}/illustrate`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`,
        },
        body: JSON.stringify(body),
      })
      const parsed = await safeReadJson<BookWithPages>(res)
      if (!res.ok) {
        throw new Error(errorMessageFromResponse(parsed, res, 'Illustration failed'))
      }
      if (parsed === null || (typeof parsed === 'object' && 'error' in parsed)) {
        throw new Error(errorMessageFromResponse(parsed, res, 'Illustration failed'))
      }
      setBook(parsed)
    } catch (err) {
      setIllustrateError(err instanceof Error ? err.message : 'Illustration failed')
    } finally {
      setIllustrating(false)
    }
  }

  const handleGeneratePortrait = async (characterIndex: number) => {
    if (!user || !book) return
    setGeneratingPortrait(characterIndex)
    setPortraitError(prev => ({ ...prev, [characterIndex]: '' }))
    try {
      const fb = (portraitFeedback[characterIndex] ?? '').trim()
      const body: { feedback?: string } = {}
      if (fb) body.feedback = fb
      const res = await fetch(
        api(`/api/books/${book.id}/characters/${characterIndex}/portrait`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.token}`,
          },
          body: JSON.stringify(body),
        }
      )
      const parsed = await safeReadJson<BookWithPages>(res)
      if (!res.ok) {
        throw new Error(errorMessageFromResponse(parsed, res, 'Portrait generation failed'))
      }
      if (parsed === null || (typeof parsed === 'object' && 'error' in parsed)) {
        throw new Error(errorMessageFromResponse(parsed, res, 'Portrait generation failed'))
      }
      // Response is the hydrated book with the new portrait_url on characters[index].
      setBook(parsed)
      setPortraitFeedback(prev => ({ ...prev, [characterIndex]: '' }))
    } catch (err) {
      setPortraitError(prev => ({
        ...prev,
        [characterIndex]: err instanceof Error ? err.message : 'Portrait generation failed',
      }))
    } finally {
      setGeneratingPortrait(null)
    }
  }

  const loadVersions = async (pageNum: number) => {
    if (!user || !book) return
    const res = await fetch(api(`/api/books/${book.id}/illustrations/${pageNum}`), {
      headers: { 'Authorization': `Bearer ${user.token}` },
    })
    if (res.ok) {
      const versions = await res.json() as IllustrationVersion[]
      setIllustrationVersions(versions)
      setShowVersions(true)
    }
  }

  const revertIllustration = async (pageNum: number, url: string) => {
    if (!user || !book) return
    const res = await fetch(api(`/api/books/${book.id}/illustrations/${pageNum}/revert`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user.token}`,
      },
      body: JSON.stringify({ url }),
    })
    if (res.ok) {
      const updated = await res.json() as BookWithPages
      setBook(updated)
      setShowVersions(false)
    }
  }

  return (
    <div
      className={`mx-auto px-4 py-8 transition-all duration-200 ease-in-out ${
        theater ? 'max-w-[min(95vw,1700px)]' : 'max-w-4xl'
      }`}
    >
      <Link to={isOwner ? '/my-books' : '/'} className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 mb-6 no-underline font-semibold">
        <ArrowLeft size={18} /> {isOwner ? 'Back to My Books' : 'Back to catalog'}
      </Link>

      {/* Post-revise comparison banner */}
      {showRevisedBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 mb-6 px-4 py-3 rounded-2xl border bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 shadow-sm"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 size={20} className="shrink-0 text-emerald-500 dark:text-emerald-400" />
            <span className="text-sm font-semibold truncate">
              Story revised to v{book.version} — see what changed
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {versionsLoading || !priorVersion ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                <Loader2 size={14} className="animate-spin" />
                Loading…
              </span>
            ) : (
              <button
                onClick={() => setShowDiffModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-600 text-white border-none cursor-pointer"
              >
                <GitCompare size={14} />
                Show changes
              </button>
            )}
            <button
              onClick={dismissBanner}
              aria-label="Dismiss revision banner"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 cursor-pointer border-none bg-transparent"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Book Header */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg overflow-hidden mb-8 transition-colors">
        <div className="md:flex">
          <div
            className="md:w-1/3 h-64 md:h-auto flex items-center justify-center text-8xl relative"
            style={{ backgroundColor: book.cover_color + '20' }}
          >
            <span className="drop-shadow-xl">{book.cover_emoji}</span>
            {isOwner && (
              <span className={`absolute top-4 right-4 text-xs font-bold px-2.5 py-1 rounded-full ${
                isDraft
                  ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                  : 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
              }`}>
                {isDraft ? 'Draft' : 'Published'} &middot; v{book.version}
              </span>
            )}
          </div>
          <div className="p-8 md:w-2/3">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">{book.title}</h1>
            <p className="text-gray-500 dark:text-gray-400 mb-1">by {book.author}</p>
            <p className="text-gray-600 dark:text-gray-300 mb-4">{book.description}</p>
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="text-sm bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full font-semibold">
                Ages {book.age_range}
              </span>
              <span className="text-sm bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-3 py-1 rounded-full font-semibold capitalize">
                {book.theme}
              </span>
              {book.is_user_created ? (
                <span className="text-sm bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 px-3 py-1 rounded-full font-semibold">
                  AI Generated
                </span>
              ) : null}
            </div>
            {book.characters && book.characters.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 self-center mr-1">Cast:</span>
                {book.characters.map((c, i) => {
                  const tone =
                    c.role === 'primary' ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' :
                    c.role === 'antagonist' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' :
                    'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
                  return (
                    <span key={i} className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${tone}`} title={c.descriptor || c.relationship || c.role}>
                      {c.name}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                    </span>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-3">
              {isDraft && isOwner && (
                <>
                  <button
                    onClick={() => void handlePublish()}
                    className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold bg-green-500 hover:bg-green-600 text-white transition-colors cursor-pointer"
                  >
                    <Send size={16} />
                    Publish
                  </button>
                  <button
                    onClick={() => {
                      const remaining = pages.filter(p => !p.illustration_url).length
                      const estimate = (remaining * 0.04).toFixed(2)
                      if (remaining > 1 && !window.confirm(`Generate ${remaining} illustration${remaining === 1 ? '' : 's'}? Estimated cost: $${estimate}.`)) return
                      void handleIllustrate()
                    }}
                    disabled={illustrating || pages.every(p => p.illustration_url) || !canBulkIllustrate}
                    title={
                      !canBulkIllustrate
                        ? 'Approve cast to illustrate with consistent characters, or skip portraits.'
                        : `Generates ${pages.filter(p => !p.illustration_url).length} image(s) at ~$0.04 each`
                    }
                    className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold bg-purple-500 hover:bg-purple-600 text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                  >
                    {illustrating ? <Loader2 size={16} className="animate-spin" /> : <Paintbrush size={16} />}
                    {illustrating ? 'Illustrating...' : `Illustrate All (~$${(pages.filter(p => !p.illustration_url).length * 0.04).toFixed(2)})`}
                  </button>
                </>
              )}
              {illustrateError && (
                <span className="text-sm text-red-500 dark:text-red-400">{illustrateError}</span>
              )}
              {isDraft && isOwner && !canBulkIllustrate && (
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                  <span>Approve cast to illustrate with consistent characters.</span>
                  <button
                    onClick={() => setSkipPortraits(true)}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 cursor-pointer border-none"
                  >
                    Skip portraits — illustrate anyway
                  </button>
                </div>
              )}
              {!isDraft && (
                <>
                  <span className="text-3xl font-bold text-gray-800 dark:text-gray-100">${book.price.toFixed(2)}</span>
                  <button
                    onClick={() => void handleAdd()}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all cursor-pointer ${
                      added
                        ? 'bg-green-500 text-white'
                        : 'bg-amber-500 hover:bg-amber-600 text-white'
                    }`}
                  >
                    <ShoppingCart size={18} />
                    {added ? 'Added!' : 'Add to Cart'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cast panel — draft + owner only. Generate/iterate per-character
          portraits so page illustration can reference a consistent cast. */}
      {isOwner && isDraft && cast.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-8 transition-colors mb-8">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">
            <Users size={22} className="inline mr-2 text-purple-500 dark:text-purple-400" />
            Cast portraits
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-1">
            Generate a portrait for each character so they stay visually consistent across every page.
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
            {portraitStepCostNote(requiredCharacters.length)}
          </p>

          <div className="space-y-4">
            {cast.map((character, index) => {
              const required = isRequiredRole(character.role)
              const generating = generatingPortrait === index
              const err = portraitError[index]
              const roleTone =
                character.role === 'primary'
                  ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                  : character.role === 'antagonist'
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                  : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
              return (
                <div
                  key={index}
                  className="flex flex-col sm:flex-row gap-4 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30"
                >
                  {/* Thumbnail or placeholder */}
                  {character.portrait_url ? (
                    <img
                      src={api(character.portrait_url)}
                      alt={`Portrait of ${character.name}`}
                      className="w-24 h-24 rounded-xl object-cover shrink-0 border border-gray-200 dark:border-gray-600"
                    />
                  ) : (
                    <div
                      className="w-24 h-24 rounded-xl shrink-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                      aria-label={`No portrait for ${character.name} yet`}
                    >
                      <Image size={28} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-gray-800 dark:text-gray-100">{character.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${roleTone}`}>
                        {character.role}
                      </span>
                      {required && (
                        <span className="text-[10px] uppercase font-bold tracking-wide text-gray-400 dark:text-gray-500">
                          Required
                        </span>
                      )}
                    </div>
                    {(character.descriptor || character.relationship) && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                        {character.descriptor || character.relationship}
                      </p>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={portraitFeedback[index] ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setPortraitFeedback(prev => ({ ...prev, [index]: e.target.value }))
                        }
                        placeholder="e.g., curlier hair, friendlier smile, blue coat..."
                        disabled={generating}
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:border-purple-400 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
                      />
                      <button
                        onClick={() => void handleGeneratePortrait(index)}
                        disabled={generating}
                        aria-label={`${character.portrait_url ? 'Regenerate' : 'Generate'} portrait for ${character.name}`}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50 cursor-pointer border-none disabled:opacity-40 whitespace-nowrap"
                      >
                        {generating ? <Loader2 size={14} className="animate-spin" /> : <Paintbrush size={14} />}
                        {generating
                          ? 'Generating...'
                          : `${character.portrait_url ? 'Regenerate' : 'Generate portrait'} (${fmtUsd(PER_IMAGE_COST_USD)})`}
                      </button>
                    </div>
                    {err && (
                      <p className="text-sm text-red-500 dark:text-red-400 mt-2">{err}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {requiredCharacters.length > 0 && (
            <p className="text-sm mt-5 font-semibold flex items-center gap-1.5">
              {castApproved ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={16} /> Cast approved — required characters all have portraits.
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">
                  Generate a portrait for each required character (primary &amp; antagonist) to approve the cast.
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* View mode toggle */}
      {pages.length > 0 && (
        <div className="flex justify-end mb-3">
          <div className="inline-flex bg-white dark:bg-gray-800 rounded-xl p-1 shadow-sm">
            <button
              onClick={() => setViewMode('spread')}
              aria-pressed={viewMode === 'spread'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer border-none transition-colors ${
                viewMode === 'spread'
                  ? 'bg-amber-500 text-white'
                  : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-700'
              }`}
            >
              <BookOpen size={14} /> Book view
            </button>
            <button
              onClick={() => setViewMode('reader')}
              aria-pressed={viewMode === 'reader'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer border-none transition-colors ${
                viewMode === 'reader'
                  ? 'bg-amber-500 text-white'
                  : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-700'
              }`}
            >
              <FileText size={14} /> Reader view
            </button>
          </div>
        </div>
      )}

      {/* Book spread view */}
      {viewMode === 'spread' && pages.length > 0 && (
        <BookSpread
          book={book}
          isOwner={!!isOwner}
          isDraft={isDraft}
          illustrating={illustrating}
          onIllustratePage={async (pageNum, fb) => {
            if (fb !== undefined) setIllustrationFeedback(fb)
            await handleIllustrate(pageNum)
          }}
          onRevise={handleRevise}
          onEditPrompt={handleEditPrompt}
          revising={revising}
          reviseError={reviseError}
          onShowVersions={loadVersions}
          illustrationVersions={illustrationVersions}
          showVersions={showVersions}
          onRevertIllustration={revertIllustration}
          theater={theater}
          onToggleTheater={toggleTheater}
        />
      )}

      {/* Page Reader (legacy reader view) */}
      {viewMode === 'reader' && pages.length > 0 && page && (
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-8 transition-colors mb-8">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-6">Read the Story</h2>

          <div className="bg-amber-50 dark:bg-gray-700/50 rounded-2xl p-8 min-h-[300px] flex flex-col justify-between transition-colors">
            <div>
              <div className="text-sm text-amber-600 dark:text-amber-400 font-semibold mb-4">
                Page {currentPage + 1} of {pages.length}
              </div>

              {page.illustration_url && (
                <div className="mb-6">
                  <div className="rounded-xl overflow-hidden shadow-md">
                    <img
                      src={api(page.illustration_url)}
                      alt={page.illustration_description}
                      className="w-full h-auto"
                    />
                  </div>
                  {isOwner && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={illustrationFeedback}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIllustrationFeedback(e.target.value)}
                          placeholder="e.g., make the colors warmer, add more stars..."
                          disabled={illustrating}
                          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:border-purple-400 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
                        />
                        <button
                          onClick={() => { void handleIllustrate(page.page_number); setIllustrationFeedback('') }}
                          disabled={illustrating}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50 cursor-pointer border-none disabled:opacity-40 whitespace-nowrap"
                        >
                          {illustrating ? <Loader2 size={14} className="animate-spin" /> : <Paintbrush size={14} />}
                          Regenerate
                        </button>
                        <button
                          onClick={() => void loadVersions(page.page_number)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer border-none whitespace-nowrap"
                        >
                          History
                        </button>
                      </div>
                      {showVersions && illustrationVersions.length > 1 && (
                        <div className="flex gap-3 overflow-x-auto pb-1">
                          {illustrationVersions.map(v => {
                            const isActive = v.url === page.illustration_url
                            const truncatedFeedback = v.feedback && v.feedback.length > 60
                              ? `${v.feedback.slice(0, 60).trimEnd()}…`
                              : v.feedback
                            const thumb = isActive ? (
                              <div
                                className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-purple-500 ring-2 ring-purple-400 dark:ring-purple-500"
                                aria-label={`Version ${v.version} (current)`}
                              >
                                <img src={api(v.url)} alt={`Version ${v.version}`} className="w-full h-full object-cover" />
                                <span className="absolute bottom-0 left-0 right-0 bg-purple-500 text-white text-[10px] font-bold text-center py-0.5">
                                  Current
                                </span>
                              </div>
                            ) : (
                              <button
                                onClick={() => void revertIllustration(page.page_number, v.url)}
                                aria-label={`Revert to version ${v.version}`}
                                className="w-16 h-16 rounded-lg overflow-hidden border-2 cursor-pointer border-gray-200 dark:border-gray-600 hover:border-purple-300 p-0"
                              >
                                <img src={api(v.url)} alt={`Version ${v.version}`} className="w-full h-full object-cover" />
                              </button>
                            )
                            return (
                              <div key={v.url} className="shrink-0 flex flex-col gap-1 w-32">
                                {thumb}
                                <div className="flex items-center gap-1.5 text-[10px]">
                                  <span className="inline-flex items-center justify-center px-1.5 rounded-full font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                                    v{v.version}
                                  </span>
                                  <span className="text-gray-500 dark:text-gray-400">
                                    {formatRelativeTime(v.created_at)}
                                  </span>
                                </div>
                                {truncatedFeedback && (
                                  <span
                                    className="text-[10px] italic text-gray-500 dark:text-gray-400 truncate"
                                    title={v.feedback ?? undefined}
                                  >
                                    “{truncatedFeedback}”
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xl text-gray-700 dark:text-gray-200 leading-relaxed mb-6">{page.text}</p>

              {page.illustration_description && !page.illustration_url && (
                <div className="bg-white/60 dark:bg-gray-600/40 rounded-xl p-4 border border-amber-200 dark:border-gray-600 flex items-start gap-3">
                  <Image size={18} className="text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-amber-700 dark:text-amber-300 italic">
                      {page.illustration_description}
                    </p>
                    {isOwner && (
                      <button
                        onClick={() => void handleIllustrate(page.page_number)}
                        disabled={illustrating}
                        className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 cursor-pointer bg-transparent border-none disabled:opacity-40"
                      >
                        <Paintbrush size={13} />
                        {illustrating ? 'Generating...' : 'Generate illustration'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center mt-8">
              <button
                onClick={() => setCurrentPage(p => p - 1)}
                disabled={currentPage === 0}
                className="flex items-center gap-1 px-4 py-2 rounded-xl font-semibold transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default bg-white dark:bg-gray-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-gray-500"
              >
                <ChevronLeft size={18} /> Previous
              </button>
              <div className="flex gap-1.5">
                {pages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i)}
                    className={`w-3 h-3 rounded-full transition-colors cursor-pointer ${
                      i === currentPage ? 'bg-amber-500' : 'bg-amber-200 dark:bg-gray-500 hover:bg-amber-300 dark:hover:bg-gray-400'
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage === pages.length - 1}
                className="flex items-center gap-1 px-4 py-2 rounded-xl font-semibold transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default bg-white dark:bg-gray-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-gray-500"
              >
                Next <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Panel — only for draft books owned by user */}
      {isOwner && isDraft && (
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-8 transition-colors">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">
            <RefreshCw size={22} className="inline mr-2 text-purple-500" />
            Revise Your Story
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Read through the story above, then describe what you'd like changed. Our AI author will create a revised version.
          </p>

          <textarea
            value={feedback}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFeedback(e.target.value)}
            placeholder="e.g., Make the ending happier, change the dragon to a unicorn, page 3 is too scary for young kids..."
            disabled={revising}
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:border-purple-400 focus:outline-none text-base h-28 resize-none placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
            maxLength={1000}
          />

          {reviseError && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl mt-3 text-sm">
              {reviseError}
            </div>
          )}

          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-gray-400 dark:text-gray-500">
              {feedback.length}/1000
            </span>
            <button
              onClick={() => void handleRevise()}
              disabled={revising || !feedback.trim()}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:shadow-lg transition-shadow cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >
              {revising ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Revising...
                </>
              ) : (
                <>
                  <RefreshCw size={18} />
                  Revise Story
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Version History — draft + owner only */}
      {isOwner && isDraft && (
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-8 transition-colors mt-8">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">
            <History size={22} className="inline mr-2 text-purple-500" />
            Version history
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Restore a previous draft of the story. Illustrations on changed pages will be cleared.
          </p>

          {versionsLoading && (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm py-2">
              <Loader2 size={16} className="animate-spin" />
              Loading version history...
            </div>
          )}

          {versionsError && !versionsLoading && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl text-sm">
              {versionsError}
            </div>
          )}

          {!versionsLoading && !versionsError && versions.length <= 1 && (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic">
              No previous versions yet. Revise the story to create one.
            </p>
          )}

          {!versionsLoading && !versionsError && versions.length > 1 && (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {versions.slice(1).map(v => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                      v{v.version}
                    </span>
                    <span className="text-sm text-gray-700 dark:text-gray-200">
                      {v.pages.length} {v.pages.length === 1 ? 'page' : 'pages'}
                    </span>
                    <span className="text-sm text-gray-400 dark:text-gray-500">
                      {formatRelativeTime(v.created_at)}
                    </span>
                  </div>
                  <button
                    onClick={() => void handleRestore(v.version)}
                    disabled={restoringVersion !== null}
                    aria-label={`Restore version ${v.version}`}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
                  >
                    {restoringVersion === v.version ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Restoring...
                      </>
                    ) : (
                      <>
                        <RotateCcw size={14} />
                        Restore
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {restoreError && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl mt-3 text-sm">
              {restoreError}
            </div>
          )}
        </div>
      )}

      {/* Revision diff modal */}
      {showDiffModal && priorVersion && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="diff-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => { setShowDiffModal(false); setLastRevisedVersion(null) }}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 id="diff-modal-title" className="text-xl font-bold text-gray-800 dark:text-gray-100 font-display">
                v{priorVersion.version} → v{book.version}
              </h2>
              <button
                onClick={() => { setShowDiffModal(false); setLastRevisedVersion(null) }}
                aria-label="Close changes modal"
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-none bg-transparent"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 sticky top-0 bg-white dark:bg-gray-800 py-2 -my-2 z-10">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  v{priorVersion.version} (before)
                </div>
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  v{book.version} (now)
                </div>
              </div>
              {diffRows.map(row => {
                const rowTint =
                  row.status === 'changed' ? 'bg-amber-50/60 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
                  row.status === 'added' ? 'bg-emerald-50/60 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' :
                  row.status === 'removed' ? 'bg-red-50/60 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
                  'bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-700'
                const statusLabel =
                  row.status === 'changed' ? 'Changed' :
                  row.status === 'added' ? 'Added' :
                  row.status === 'removed' ? 'Removed' :
                  'Unchanged'
                const labelTone =
                  row.status === 'changed' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' :
                  row.status === 'added' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' :
                  row.status === 'removed' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' :
                  'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                return (
                  <div
                    key={row.pageNumber}
                    className={`rounded-2xl border p-4 ${rowTint}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                        Page {row.pageNumber}
                      </span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${labelTone}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {row.oldText !== null ? (
                          row.oldText
                        ) : (
                          <span className="italic text-gray-400 dark:text-gray-500">— not in v{priorVersion.version} —</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {row.newText !== null ? (
                          row.newText
                        ) : (
                          <span className="italic text-gray-400 dark:text-gray-500">— not in v{book.version} —</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => { setShowDiffModal(false); setLastRevisedVersion(null) }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer border-none"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
