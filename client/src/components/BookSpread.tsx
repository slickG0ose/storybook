import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Image as ImageIcon, RefreshCw, Loader2, Paintbrush, Check, History, Maximize2, Minimize2 } from 'lucide-react'
import type { BookWithPages, IllustrationVersion, Page } from '../types'
import { api } from '../lib/apiBase'

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

interface BookSpreadProps {
  book: BookWithPages;
  isOwner: boolean;
  isDraft: boolean;
  illustrating: boolean;
  onIllustratePage: (pageNumber: number, feedback?: string) => Promise<void>;
  onRevise: (feedback: string, newPageCount?: number) => Promise<void>;
  onEditPrompt?: (pageNumber: number, description: string) => Promise<void>;
  revising: boolean;
  reviseError?: string;
  onShowVersions?: (pageNumber: number) => Promise<void>;
  illustrationVersions?: IllustrationVersion[];
  showVersions?: boolean;
  onRevertIllustration?: (pageNumber: number, url: string) => Promise<void>;
  theater: boolean;
  onToggleTheater: () => void;
}

const DEFAULT_STYLE_DESCRIPTOR = 'Whimsical, colorful, warm, suitable for young children';

/**
 * Mirror of how the server assembles the image-AI prompt
 * (server/src/services/illustrations.ts). If that changes, update this.
 */
function buildImagePromptPreview(description: string, styleDescriptor: string | null): string {
  const style = (styleDescriptor || '').trim() || DEFAULT_STYLE_DESCRIPTOR;
  const desc = description.trim() || '(no description set)';
  return `Children's book illustration, ${desc}. ${style}. No text or words in the image.`;
}

type SpreadKind =
  | { kind: 'cover' }
  | { kind: 'story'; page: Page; pageIndex: number }
  | { kind: 'end' }

export default function BookSpread({
  book,
  isOwner,
  isDraft,
  illustrating,
  onIllustratePage,
  onRevise,
  onEditPrompt,
  revising,
  reviseError,
  onShowVersions,
  illustrationVersions,
  showVersions,
  onRevertIllustration,
  theater,
  onToggleTheater,
}: BookSpreadProps) {
  const frameWidthClass = theater
    ? 'max-w-[min(90vw,1600px)]'
    : 'max-w-[900px]'
  const pages = book.pages || []
  const spreads: SpreadKind[] = [
    { kind: 'cover' },
    ...pages.map((page, pageIndex) => ({ kind: 'story' as const, page, pageIndex })),
    { kind: 'end' as const },
  ]

  const [spreadIndex, setSpreadIndex] = useState(0)
  const [flipping, setFlipping] = useState<'next' | 'prev' | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [reviseTargetPageCount, setReviseTargetPageCount] = useState<number>(pages.length)
  const [illustrationFeedback, setIllustrationFeedback] = useState('')

  const spread = spreads[spreadIndex]
  // canNext/canPrev keep spreadIndex in bounds; this guard exists so the
  // discriminated-union narrowing on `spread.kind` works in the JSX below.
  if (!spread) return null
  const canPrev = spreadIndex > 0
  const canNext = spreadIndex < spreads.length - 1

  const turnPage = (dir: 'next' | 'prev'): void => {
    if (flipping) return
    if (dir === 'next' && !canNext) return
    if (dir === 'prev' && !canPrev) return
    setFlipping(dir)
    setTimeout(() => {
      setSpreadIndex(i => dir === 'next' ? i + 1 : i - 1)
      setFlipping(null)
    }, 250)
  }

  const handleSubmitFeedback = async (): Promise<void> => {
    if (!feedback.trim()) return
    const newCount = reviseTargetPageCount !== pages.length ? reviseTargetPageCount : undefined
    await onRevise(feedback, newCount)
    setFeedback('')
    setShowFeedback(false)
    setSpreadIndex(0)
  }

  const handleRegeneratePageIllustration = async (pageNumber: number): Promise<void> => {
    await onIllustratePage(pageNumber, illustrationFeedback.trim() || undefined)
    setIllustrationFeedback('')
  }

  const flipClass =
    flipping === 'next' ? 'opacity-0 -translate-x-4' :
    flipping === 'prev' ? 'opacity-0 translate-x-4' :
    'opacity-100 translate-x-0'

  return (
    <div className="bg-amber-50 dark:bg-gray-900 rounded-3xl shadow-lg p-4 md:p-8 transition-colors mb-8">
      {/* Spine + book frame */}
      <div
        data-testid="book-spread-frame"
        className={`relative mx-auto bg-amber-100 dark:bg-gray-800 rounded-2xl shadow-2xl border border-amber-200 dark:border-gray-700 transition-all duration-200 ease-in-out ${frameWidthClass}`}
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(0,0,0,0.08) 0%, transparent 4%, transparent 49%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0.18) 50%, transparent 51%, transparent 96%, rgba(0,0,0,0.08) 100%)',
        }}
      >
        <div className={`grid grid-cols-2 min-h-[400px] md:min-h-[480px] transition-all duration-200 ease-in-out ${flipClass}`}>
          {spread.kind === 'cover' && (
            <>
              <PageCanvas side="left">
                <div className="text-center text-amber-700 dark:text-amber-300/60 italic text-sm self-center">
                  {book.is_user_created ? 'A story written just for you' : null}
                </div>
              </PageCanvas>
              <PageCanvas side="right">
                <div
                  className="flex flex-col items-center justify-center h-full p-8 text-center rounded-r-xl"
                  style={{ backgroundColor: book.cover_color + '20' }}
                >
                  {book.cover_url ? (
                    <img
                      src={api(book.cover_url)}
                      alt={book.title}
                      className="max-h-48 md:max-h-64 rounded-xl shadow-md mb-4"
                    />
                  ) : (
                    <div className="text-7xl md:text-8xl mb-4 drop-shadow-xl">{book.cover_emoji}</div>
                  )}
                  <h2 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">{book.title}</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">by {book.author}</p>
                </div>
              </PageCanvas>
            </>
          )}

          {spread.kind === 'story' && (
            <>
              <PageCanvas side="left">
                <PageIllustration
                  page={spread.page}
                  isOwner={isOwner}
                  isDraft={isDraft}
                  illustrating={illustrating}
                  feedback={illustrationFeedback}
                  onFeedbackChange={setIllustrationFeedback}
                  onRegenerate={() => void handleRegeneratePageIllustration(spread.page.page_number)}
                  onEditPrompt={onEditPrompt}
                  styleDescriptor={book.style_descriptor}
                  onShowVersions={onShowVersions}
                  illustrationVersions={illustrationVersions}
                  showVersions={showVersions}
                  onRevertIllustration={onRevertIllustration}
                />
              </PageCanvas>
              <PageCanvas side="right">
                <div className="flex-1 flex flex-col justify-between p-2">
                  <p className="text-base md:text-lg text-gray-700 dark:text-gray-200 leading-relaxed font-display">
                    {spread.page.text}
                  </p>
                  <div className="text-right text-xs text-amber-700/60 dark:text-amber-300/40 mt-4 italic">
                    — page {spread.page.page_number}
                  </div>
                </div>
              </PageCanvas>
            </>
          )}

          {spread.kind === 'end' && (
            <>
              <PageCanvas side="left">
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <div className="text-3xl font-bold text-gray-700 dark:text-gray-200 font-display mb-2">The End</div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Hope you enjoyed the story.</p>
                </div>
              </PageCanvas>
              <PageCanvas side="right">
                <div className="flex-1 flex items-center justify-center text-center p-6 text-gray-400 dark:text-gray-500 text-sm italic">
                  {book.description}
                </div>
              </PageCanvas>
            </>
          )}
        </div>

        {/* Page turn controls */}
        <button
          onClick={() => turnPage('prev')}
          disabled={!canPrev || !!flipping}
          aria-label="Previous spread"
          className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 dark:bg-gray-700 shadow-md flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-default hover:bg-white border-none text-amber-700 dark:text-amber-300"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={() => turnPage('next')}
          disabled={!canNext || !!flipping}
          aria-label="Next spread"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 dark:bg-gray-700 shadow-md flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-default hover:bg-white border-none text-amber-700 dark:text-amber-300"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Footer: position dots + revise CTA */}
      <div className={`flex flex-col md:flex-row items-center justify-between mt-4 gap-3 mx-auto transition-all duration-200 ease-in-out ${frameWidthClass}`}>
        <div className="flex gap-1.5">
          {spreads.map((_, i) => (
            <button
              key={i}
              onClick={() => setSpreadIndex(i)}
              aria-label={`Go to spread ${i + 1}`}
              className={`w-2.5 h-2.5 rounded-full transition-colors cursor-pointer border-none ${
                i === spreadIndex ? 'bg-amber-500' : 'bg-amber-200 dark:bg-gray-600 hover:bg-amber-300'
              }`}
            />
          ))}
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {spread.kind === 'cover' ? 'Cover' : spread.kind === 'end' ? 'End' : `Page ${spread.pageIndex + 1} of ${pages.length}`}
        </span>
        {isOwner && isDraft && (
          <button
            onClick={() => setShowFeedback(s => !s)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 cursor-pointer border-none"
          >
            <RefreshCw size={14} />
            {showFeedback ? 'Cancel' : 'Suggest changes'}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleTheater}
          aria-label={theater ? 'Exit theater mode' : 'Expand to theater mode'}
          aria-pressed={theater}
          className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-gray-700 hover:bg-amber-200 dark:hover:bg-gray-600 cursor-pointer border-none"
        >
          {theater ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {/* Inline revision panel (only when the user opens it from the spread footer) */}
      {isOwner && isDraft && showFeedback && (
        <div className={`mt-4 bg-white dark:bg-gray-800 rounded-2xl p-5 mx-auto border-2 border-purple-200 dark:border-purple-800 transition-all duration-200 ease-in-out ${frameWidthClass}`}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            Describe what you'd like changed and the AI author will create a revised version.
          </p>
          <textarea
            value={feedback}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFeedback(e.target.value)}
            placeholder="e.g., Make the ending happier, change the dragon to a unicorn, page 3 is too scary..."
            disabled={revising}
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:border-purple-400 focus:outline-none text-sm h-24 resize-none placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
            maxLength={1000}
          />
          <div className="mt-3 flex items-center gap-3">
            <label htmlFor="revise-page-count" className="text-xs font-semibold text-gray-600 dark:text-gray-400 shrink-0">Page count:</label>
            <input
              id="revise-page-count"
              type="range"
              min={3}
              max={15}
              value={reviseTargetPageCount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReviseTargetPageCount(parseInt(e.target.value, 10))}
              disabled={revising}
              className="flex-1 accent-purple-500 disabled:opacity-50"
            />
            <span className="text-sm font-bold text-purple-600 dark:text-purple-300 w-24 text-right">
              {reviseTargetPageCount} {reviseTargetPageCount === pages.length ? '(same)' : reviseTargetPageCount > pages.length ? `(+${reviseTargetPageCount - pages.length})` : `(${reviseTargetPageCount - pages.length})`}
            </span>
          </div>
          {reviseError && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl mt-3 text-sm">
              {reviseError}
            </div>
          )}
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-gray-400 dark:text-gray-500">{feedback.length}/1000</span>
            <button
              onClick={() => void handleSubmitFeedback()}
              disabled={revising || !feedback.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:shadow-lg transition-shadow cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >
              {revising ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {revising ? 'Revising...' : 'Revise Story'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PageCanvas({ side, children }: { side: 'left' | 'right'; children: React.ReactNode }) {
  const radius = side === 'left' ? 'rounded-l-xl' : 'rounded-r-xl'
  const innerShadow =
    side === 'left'
      ? 'shadow-[inset_-8px_0_12px_-12px_rgba(0,0,0,0.4)]'
      : 'shadow-[inset_8px_0_12px_-12px_rgba(0,0,0,0.4)]'
  // Pad the outer edge by 3.5rem (pl-14 / pr-14) so the absolute-positioned
  // chevron buttons don't overlap text or images that grow into them.
  const outerPad = side === 'left' ? 'pl-14 pr-4 md:pl-16 md:pr-6' : 'pr-14 pl-4 md:pr-16 md:pl-6'
  return (
    <div className={`bg-white dark:bg-gray-800 ${radius} ${innerShadow} ${outerPad} py-4 md:py-6 flex flex-col`}>
      {children}
    </div>
  )
}

interface PageIllustrationProps {
  page: Page;
  isOwner: boolean;
  isDraft: boolean;
  illustrating: boolean;
  feedback: string;
  onFeedbackChange: (v: string) => void;
  onRegenerate: () => void;
  onEditPrompt?: (pageNumber: number, description: string) => Promise<void>;
  styleDescriptor?: string | null;
  onShowVersions?: (pageNumber: number) => Promise<void>;
  illustrationVersions?: IllustrationVersion[];
  showVersions?: boolean;
  onRevertIllustration?: (pageNumber: number, url: string) => Promise<void>;
}

function PageIllustration({
  page,
  isOwner,
  isDraft,
  illustrating,
  feedback,
  onFeedbackChange,
  onRegenerate,
  onEditPrompt,
  styleDescriptor,
  onShowVersions,
  illustrationVersions,
  showVersions,
  onRevertIllustration,
}: PageIllustrationProps) {
  const [draftPrompt, setDraftPrompt] = useState(page.illustration_description);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSavedAt, setPromptSavedAt] = useState<number | null>(null);
  const [showPromptPreview, setShowPromptPreview] = useState(false);

  useEffect(() => {
    setDraftPrompt(page.illustration_description);
  }, [page.illustration_description, page.id]);

  const promptDirty = draftPrompt.trim() !== page.illustration_description.trim();

  const savePromptIfChanged = async (): Promise<void> => {
    if (!onEditPrompt) return;
    const trimmed = draftPrompt.trim();
    if (!trimmed || !promptDirty) return;
    setSavingPrompt(true);
    try {
      await onEditPrompt(page.page_number, trimmed);
      setPromptSavedAt(Date.now());
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleRegenerateWithSavedPrompt = async (): Promise<void> => {
    if (promptDirty) await savePromptIfChanged();
    onRegenerate();
  };
  if (page.illustration_url) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 rounded-xl overflow-hidden shadow-md">
          <img
            src={api(page.illustration_url)}
            alt={page.illustration_description}
            className="w-full h-full object-cover"
          />
        </div>
        {isOwner && isDraft && (
          <div className="mt-2">
            <label
              htmlFor={`redo-feedback-${page.page_number}`}
              className="block text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1"
            >
              What to change on re-roll
            </label>
            <textarea
              id={`redo-feedback-${page.page_number}`}
              value={feedback}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onFeedbackChange(e.target.value)}
              placeholder="e.g., warmer colors, add more stars, make the dragon smaller..."
              disabled={illustrating}
              rows={3}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-xs focus:border-purple-400 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50 resize-none"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              {onShowVersions && (
                <button
                  onClick={() => void onShowVersions(page.page_number)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer border-none whitespace-nowrap"
                >
                  <History size={12} />
                  History
                </button>
              )}
              <button
                onClick={onRegenerate}
                disabled={illustrating}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 cursor-pointer border-none disabled:opacity-40 whitespace-nowrap"
              >
                {illustrating ? <Loader2 size={12} className="animate-spin" /> : <Paintbrush size={12} />}
                Redo (~$0.04)
              </button>
            </div>
            {showVersions && illustrationVersions && illustrationVersions.length > 1 && (
              <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
                {illustrationVersions.map(v => {
                  const isActive = v.url === page.illustration_url;
                  const truncatedFeedback = v.feedback && v.feedback.length > 60
                    ? `${v.feedback.slice(0, 60).trimEnd()}…`
                    : v.feedback;
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
                      onClick={() => onRevertIllustration && void onRevertIllustration(page.page_number, v.url)}
                      className="w-16 h-16 rounded-lg overflow-hidden border-2 cursor-pointer border-gray-200 dark:border-gray-600 hover:border-purple-300 p-0"
                      aria-label={`Revert to version ${v.version}`}
                    >
                      <img src={api(v.url)} alt={`Version ${v.version}`} className="w-full h-full object-cover" />
                    </button>
                  );
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
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const canEditPrompt = isOwner && isDraft && !!onEditPrompt;
  const recentlySaved = promptSavedAt !== null && Date.now() - promptSavedAt < 3000;

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-amber-100/60 to-amber-200/40 dark:from-gray-700 dark:to-gray-700/60 rounded-xl p-4 border-2 border-dashed border-amber-300 dark:border-gray-600">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-300/70 text-xs font-semibold">
          <ImageIcon size={14} />
          {canEditPrompt ? 'Illustration prompt (editable)' : 'Illustration prompt'}
        </div>
        {canEditPrompt && (savingPrompt
          ? <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Saving…</span>
          : recentlySaved
            ? <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><Check size={10} /> Saved</span>
            : promptDirty
              ? <span className="text-xs text-amber-600 dark:text-amber-400">unsaved</span>
              : null
        )}
      </div>
      {canEditPrompt ? (
        <textarea
          value={draftPrompt}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraftPrompt(e.target.value)}
          onBlur={() => { void savePromptIfChanged() }}
          disabled={illustrating || savingPrompt}
          maxLength={2000}
          rows={6}
          placeholder="Describe what the illustration should show. Edit this before generating to save money on re-rolls."
          className="w-full flex-1 min-h-[120px] px-3 py-2 mb-2 rounded-lg border border-amber-200 dark:border-gray-600 bg-white/80 dark:bg-gray-800/60 text-amber-900 dark:text-amber-100 text-xs leading-snug focus:border-amber-500 focus:outline-none placeholder-amber-400 dark:placeholder-amber-700 disabled:opacity-50 resize-none"
        />
      ) : (
        <p className="text-xs text-amber-700 dark:text-amber-300/80 italic mb-3 leading-snug flex-1">
          {page.illustration_description}
        </p>
      )}
      {isOwner && isDraft && (
        <div className="mb-3">
          <button
            onClick={() => setShowPromptPreview(s => !s)}
            className="text-xs text-amber-700 dark:text-amber-300 hover:underline cursor-pointer bg-transparent border-none p-0"
          >
            {showPromptPreview ? 'Hide full prompt' : 'Preview full prompt (what gets sent to the image AI)'}
          </button>
          {showPromptPreview && (
            <div className="mt-1.5 px-2 py-1.5 rounded border border-amber-200 dark:border-gray-600 bg-amber-50/60 dark:bg-gray-800/40 text-xs text-amber-900 dark:text-amber-200 font-mono leading-snug whitespace-pre-wrap break-words">
              {buildImagePromptPreview(draftPrompt, styleDescriptor ?? null)}
            </div>
          )}
        </div>
      )}
      {isOwner && isDraft && (
        <button
          onClick={() => void handleRegenerateWithSavedPrompt()}
          disabled={illustrating || savingPrompt}
          className="self-center flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-500 text-white hover:bg-purple-600 cursor-pointer border-none disabled:opacity-40"
        >
          {illustrating ? <Loader2 size={12} className="animate-spin" /> : <Paintbrush size={12} />}
          {illustrating ? 'Drawing...' : 'Generate illustration (~$0.04)'}
        </button>
      )}
    </div>
  )
}
