import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Sparkles, Wand2, Loader2, Plus, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/apiBase'
import { PER_IMAGE_COST_USD, fmtUsd, portraitStepCostNote } from '../lib/cost'
import type { Character, CharacterRole } from '../types'

interface ThemeOption {
  value: string;
  label: string;
  emoji: string;
}

const THEMES: ThemeOption[] = [
  { value: 'adventure', label: 'Adventure', emoji: '\u{1F3D4}\u{FE0F}' },
  { value: 'fantasy', label: 'Fantasy', emoji: '\u{1FA84}' },
  { value: 'friendship', label: 'Friendship', emoji: '\u{1F49B}' },
  { value: 'humor', label: 'Humor', emoji: '\u{1F602}' },
  { value: 'nature', label: 'Nature', emoji: '\u{1F33F}' },
  { value: 'imagination', label: 'Imagination', emoji: '\u{1F308}' },
  { value: 'animals', label: 'Animals', emoji: '\u{1F43E}' },
  { value: 'space', label: 'Space', emoji: '\u{1F680}' },
]

const AGE_RANGES: string[] = ['2-4', '3-6', '4-7', '5-9', '6-10']

interface StylePreset {
  value: string;
  label: string;
  emoji: string;
  descriptor: string;
}

const STYLE_PRESETS: StylePreset[] = [
  { value: 'storybook', label: 'Storybook Classic', emoji: '\u{1F4D6}', descriptor: 'Classic storybook illustration, soft ink outlines with watercolor washes, warm and whimsical, gentle textures, suitable for young children' },
  { value: 'watercolor', label: 'Watercolor', emoji: '\u{1F3A8}', descriptor: 'Loose watercolor painting, soft pastel washes, visible paper texture, gentle bleeding edges, dreamy and warm' },
  { value: 'pixar', label: 'Pixar-style 3D', emoji: '\u{1F3AC}', descriptor: 'Pixar-inspired 3D animated style, soft cinematic lighting, expressive characters with large eyes, vibrant colors' },
  { value: 'anime', label: 'Anime', emoji: '\u{1F338}', descriptor: 'Friendly anime/Studio Ghibli inspired style, soft cel-shading, bright skies, expressive eyes, gentle and warm' },
  { value: 'crayon', label: 'Crayon Sketch', emoji: '\u{270F}\u{FE0F}', descriptor: "Children's crayon drawing, hand-drawn waxy textures, vivid primary colors, playful and naive, like a child's artwork" },
  { value: 'photoreal', label: 'Photoreal Soft', emoji: '\u{1F4F8}', descriptor: 'Soft photorealistic style with painterly highlights, gentle golden-hour lighting, warm and inviting, suitable for young children' },
]

const RELATIONSHIPS: string[] = ['best friend', 'sibling', 'parent', 'grandparent', 'pet', 'mentor', 'other']
const MAX_CAST = 6

// PER_IMAGE_COST_USD + fmtUsd now live in ../lib/cost (single source of truth,
// shared with the BookDetail Cast panel). Re-exported here so existing importers
// of the constant from this page keep resolving.
export { PER_IMAGE_COST_USD }

// Cost-copy builders — all derive from PER_IMAGE_COST_USD.
export const quickModeCostLabel = (): string => `$0 — no image AI calls`
export const coverModeCostLabel = (): string => `~${fmtUsd(PER_IMAGE_COST_USD)} — 1 image AI call`
export const fullModeCostLabel = (pageCount: number): string => {
  const imageCount = pageCount + 1 // cover + every page
  return `~${fmtUsd(imageCount * PER_IMAGE_COST_USD)} — ${imageCount} image AI calls`
}
export const laterClickCostNote = (): string =>
  `In all modes you can still generate or regenerate individual illustrations later from the book page. Each later click is ~${fmtUsd(PER_IMAGE_COST_USD)}.`

type DraftCharacter = Character & { _id: number }

let nextId = 1
const newDraft = (role: CharacterRole, relationship?: string): DraftCharacter => ({
  _id: nextId++,
  role,
  name: '',
  descriptor: '',
  relationship,
})

export default function CreateBook() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [step, setStep] = useState(1)
  const [theme, setTheme] = useState('')
  const [customTheme, setCustomTheme] = useState('')
  const [stylePreset, setStylePreset] = useState<string>('storybook')
  const [cast, setCast] = useState<DraftCharacter[]>([newDraft('primary')])
  const [ageRange, setAgeRange] = useState('')
  const [additionalDetails, setAdditionalDetails] = useState('')
  const [previewMode, setPreviewMode] = useState<'quick' | 'cover' | 'full'>('quick')
  const [pageCount, setPageCount] = useState<number>(5)
  const [styleReferenceUrl, setStyleReferenceUrl] = useState<string>('')
  const [customStyleDescriptor, setCustomStyleDescriptor] = useState<string>('')
  const [styleUploading, setStyleUploading] = useState(false)
  const [styleUploadError, setStyleUploadError] = useState('')
  const [styleDragOver, setStyleDragOver] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const isCustomTheme = theme === '__custom__'
  const effectiveTheme = isCustomTheme ? customTheme.trim() : theme
  const presetDescriptor = STYLE_PRESETS.find(s => s.value === stylePreset)?.descriptor
  const effectiveStyleDescriptor = customStyleDescriptor.trim() || presetDescriptor

  const handleStyleUpload = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      setStyleUploadError('Please upload a JPG or PNG image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setStyleUploadError('Image must be under 5MB.')
      return
    }
    setStyleUploading(true)
    setStyleUploadError('')
    try {
      const fd = new FormData()
      fd.append('image', file)
      // The route is requireAuth + spendGate as of #96 — it makes a real vision
      // call, so it is metered like every other paid path. No Content-Type header:
      // fetch sets the multipart boundary itself, and setting it by hand breaks
      // the upload.
      const headers: Record<string, string> = {}
      if (user?.token) headers['Authorization'] = `Bearer ${user.token}`
      const res = await fetch(api('/api/uploads/style-reference'), {
        method: 'POST',
        headers,
        body: fd,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Upload failed')
      }
      const data = await res.json() as { url: string; descriptor: string | null }
      setStyleReferenceUrl(data.url)
      if (data.descriptor) setCustomStyleDescriptor(data.descriptor)
    } catch (err) {
      setStyleUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setStyleUploading(false)
    }
  }

  const clearStyleReference = (): void => {
    setStyleReferenceUrl('')
    setCustomStyleDescriptor('')
    setStyleUploadError('')
  }

  const primary = cast.find(c => c.role === 'primary')
  const antagonists = cast.filter(c => c.role === 'antagonist')
  const supporting = cast.filter(c => c.role === 'supporting')
  const canAddMore = cast.length < MAX_CAST

  const updateCharacter = (id: number, patch: Partial<DraftCharacter>): void => {
    setCast(prev => prev.map(c => c._id === id ? { ...c, ...patch } : c))
  }

  const addCharacter = (role: CharacterRole, relationship?: string): void => {
    if (!canAddMore) return
    setCast(prev => [...prev, newDraft(role, relationship)])
  }

  const removeCharacter = (id: number): void => {
    setCast(prev => prev.filter(c => c._id !== id))
  }

  const canProceed = (): boolean => {
    if (step === 1) return effectiveTheme !== ''
    if (step === 2) {
      const primaryValid = !!primary && primary.name.trim() !== ''
      const supportingValid = cast.every(c => c.name.trim() !== '')
      return primaryValid && supportingValid && ageRange !== ''
    }
    return true
  }

  const handleGenerate = async (): Promise<void> => {
    setGenerating(true)
    setError('')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (user?.token) headers['Authorization'] = `Bearer ${user.token}`
      const characters: Character[] = cast.map(({ role, name, descriptor, relationship }) => ({
        role,
        name: name.trim(),
        descriptor: descriptor?.trim() || undefined,
        relationship: relationship?.trim() || undefined,
      }))
      const res = await fetch(api('/api/generate'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          theme: effectiveTheme,
          characters,
          ageRange,
          additionalDetails,
          styleDescriptor: effectiveStyleDescriptor,
          styleReferenceUrl: styleReferenceUrl || undefined,
          previewMode,
          pageCount,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error || 'Generation failed')
      }
      const book = await res.json() as { id: string }
      navigate(`/book/${book.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      setGenerating(false)
    }
  }

  if (generating) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-20 text-center">
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-8 sm:p-12 transition-colors">
          <Loader2 size={48} className="animate-spin text-purple-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">Creating your story...</h2>
          <p className="text-gray-500 dark:text-gray-400">
            {previewMode === 'quick' && <>Our AI author is crafting a magical tale about {primary?.name || 'your character'}. This takes about 15 seconds.</>}
            {previewMode === 'cover' && <>Writing the story and painting the cover. This takes about 45 seconds.</>}
            {previewMode === 'full' && <>Writing the story and illustrating every page. Sit tight — this takes about 2 minutes.</>}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">
          <Sparkles className="inline text-purple-500 mr-2" size={32} />
          Create Your Book
        </h1>
        <p className="text-gray-500 dark:text-gray-400">Design a one-of-a-kind story in three easy steps</p>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
              s <= step ? 'bg-purple-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
            }`}>
              {s}
            </div>
            {s < 3 && <div className={`w-12 h-1 rounded ${s < step ? 'bg-purple-500' : 'bg-gray-200 dark:bg-gray-700'}`} />}
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-5 sm:p-8 transition-colors">
        {/* Step 1: Theme + Style */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 font-display mb-4">Choose a Theme</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
              {THEMES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  className={`p-3 sm:p-4 rounded-2xl text-center transition-all cursor-pointer border-2 ${
                    theme === t.value
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 shadow-md'
                      : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:border-purple-200 dark:hover:border-purple-700'
                  }`}
                >
                  <div className="text-3xl mb-1">{t.emoji}</div>
                  <div className="font-semibold text-sm text-gray-700 dark:text-gray-300">{t.label}</div>
                </button>
              ))}
              <button
                onClick={() => setTheme('__custom__')}
                className={`p-3 sm:p-4 rounded-2xl text-center transition-all cursor-pointer border-2 border-dashed ${
                  isCustomTheme
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 shadow-md'
                    : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 hover:border-purple-300 dark:hover:border-purple-700'
                }`}
              >
                <div className="text-3xl mb-1">{'\u{270F}\u{FE0F}'}</div>
                <div className="font-semibold text-sm text-gray-700 dark:text-gray-300">Custom...</div>
              </button>
            </div>
            {isCustomTheme && (
              <input
                type="text"
                value={customTheme}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomTheme(e.target.value)}
                placeholder="e.g., pirate bakery, underwater school, mountain rescue..."
                maxLength={60}
                className="w-full mt-3 px-4 py-3 rounded-xl border-2 border-purple-300 dark:border-purple-700 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:border-purple-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500"
              />
            )}

            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 font-display mt-8 mb-2">Pick an Art Style</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Applied to every illustration in your book for a consistent look.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
              {STYLE_PRESETS.map(s => (
                <button
                  key={s.value}
                  onClick={() => setStylePreset(s.value)}
                  className={`p-3 rounded-2xl text-center transition-all cursor-pointer border-2 ${
                    stylePreset === s.value
                      ? 'border-pink-500 bg-pink-50 dark:bg-pink-900/30 shadow-md'
                      : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:border-pink-200 dark:hover:border-pink-700'
                  }`}
                >
                  <div className="text-2xl mb-1">{s.emoji}</div>
                  <div className="font-semibold text-xs text-gray-700 dark:text-gray-300">{s.label}</div>
                </button>
              ))}
            </div>

            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mt-6 mb-2">Or upload a reference image (optional)</h3>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">We'll read the style from your image and use it for every illustration. Overrides the preset above.</p>

            {styleReferenceUrl ? (
              <div className="flex gap-3 items-start p-3 rounded-2xl border-2 border-pink-200 dark:border-pink-800 bg-pink-50/40 dark:bg-pink-900/10">
                <img
                  src={api(styleReferenceUrl)}
                  alt="Style reference"
                  className="w-20 h-20 object-cover rounded-lg shadow-sm shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                    Detected style (editable)
                  </label>
                  <textarea
                    value={customStyleDescriptor}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCustomStyleDescriptor(e.target.value)}
                    placeholder="Describe the art style you want..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-xs focus:border-pink-400 focus:outline-none resize-none placeholder-gray-400 dark:placeholder-gray-500"
                  />
                  <button
                    onClick={clearStyleReference}
                    className="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 cursor-pointer bg-transparent border-none p-0"
                  >
                    <X size={12} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <label
                onDragOver={(e: React.DragEvent<HTMLLabelElement>) => { e.preventDefault(); setStyleDragOver(true) }}
                onDragLeave={() => setStyleDragOver(false)}
                onDrop={(e: React.DragEvent<HTMLLabelElement>) => {
                  e.preventDefault()
                  setStyleDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) void handleStyleUpload(file)
                }}
                className={`flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${
                  styleDragOver
                    ? 'border-pink-500 bg-pink-50 dark:bg-pink-900/30'
                    : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 hover:border-pink-300 dark:hover:border-pink-700'
                } ${styleUploading ? 'opacity-50 cursor-default' : ''}`}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={styleUploading}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const file = e.target.files?.[0]
                    if (file) void handleStyleUpload(file)
                  }}
                  className="hidden"
                />
                {styleUploading ? (
                  <>
                    <Loader2 size={24} className="animate-spin text-pink-500 mb-2" />
                    <p className="text-sm text-gray-600 dark:text-gray-300">Reading style from image...</p>
                  </>
                ) : (
                  <>
                    <div className="text-3xl mb-2">{'\u{1F4F8}'}</div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Drag &amp; drop an image, or click to browse</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">JPG or PNG, max 5MB</p>
                  </>
                )}
              </label>
            )}
            {styleUploadError && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl mt-3 text-sm">
                {styleUploadError}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Cast & Age */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 font-display mb-4">Build Your Cast</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Start with your primary character. You can add antagonists and supporting characters (family, friends, pets) to make the story richer.</p>

            <div className="space-y-3 mb-6">
              {primary && (
                <CharacterRow
                  character={primary}
                  label="Primary character"
                  accent="purple"
                  onChange={patch => updateCharacter(primary._id, patch)}
                />
              )}

              {antagonists.map(c => (
                <CharacterRow
                  key={c._id}
                  character={c}
                  label="Antagonist"
                  accent="red"
                  onChange={patch => updateCharacter(c._id, patch)}
                  onRemove={() => removeCharacter(c._id)}
                />
              ))}

              {supporting.map(c => (
                <CharacterRow
                  key={c._id}
                  character={c}
                  label="Supporting character"
                  accent="amber"
                  showRelationship
                  onChange={patch => updateCharacter(c._id, patch)}
                  onRemove={() => removeCharacter(c._id)}
                />
              ))}
            </div>

            {canAddMore && (
              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  onClick={() => addCharacter('antagonist')}
                  className="flex items-center gap-1 px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-sm font-semibold bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 cursor-pointer border-none"
                >
                  <Plus size={14} /> Add antagonist
                </button>
                <button
                  onClick={() => addCharacter('supporting', 'best friend')}
                  className="flex items-center gap-1 px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-sm font-semibold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer border-none"
                >
                  <Plus size={14} /> Add supporting character
                </button>
                <span className="text-xs text-gray-400 dark:text-gray-500 self-center ml-1">{cast.length} of {MAX_CAST} characters</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">Age Range</label>
              <div className="flex flex-wrap gap-2">
                {AGE_RANGES.map(ar => (
                  <button
                    key={ar}
                    onClick={() => setAgeRange(ar)}
                    className={`px-4 py-2 min-h-[44px] sm:min-h-0 inline-flex items-center justify-center rounded-xl font-semibold text-sm transition-all cursor-pointer ${
                      ageRange === ar
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    Ages {ar}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Details & Generate */}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 font-display mb-4">Any Special Requests?</h2>
            <textarea
              value={additionalDetails}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAdditionalDetails(e.target.value)}
              placeholder="Optional: Add any special details, like the character's personality, a lesson you want in the story, or a specific setting..."
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:border-purple-400 focus:outline-none text-base h-32 resize-none placeholder-gray-400 dark:placeholder-gray-500"
              maxLength={500}
            />

            <div className="mt-6">
              <h3 className="font-bold text-gray-800 dark:text-gray-100 font-display mb-2">Page Count</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">How long should the story be? You can also add or remove pages later when revising.</p>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={3}
                  max={15}
                  value={pageCount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPageCount(parseInt(e.target.value, 10))}
                  className="flex-1 accent-purple-500"
                  aria-label="Page count"
                />
                <span className="text-lg font-bold text-purple-600 dark:text-purple-300 w-20 text-right">{pageCount} pages</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1 px-1">
                <span>3 (very short)</span>
                <span>5 (default)</span>
                <span>15 (long)</span>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="font-bold text-gray-800 dark:text-gray-100 font-display mb-2">Illustration Mode</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                Every mode generates the full story text and an illustration prompt for each page.
                The difference is how many of those prompts we actually send to the image AI right now.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <PreviewModeCard
                  selected={previewMode === 'quick'}
                  onClick={() => setPreviewMode('quick')}
                  label="No images (preview prompts)"
                  time="~15s"
                  cost={quickModeCostLabel()}
                  description="Story + per-page illustration prompts. Zero image AI cost. Review the prompts first, then generate individual pages later."
                />
                <PreviewModeCard
                  selected={previewMode === 'cover'}
                  onClick={() => setPreviewMode('cover')}
                  label="Cover only"
                  time="~45s"
                  cost={coverModeCostLabel()}
                  description="Story + 1 generated cover image. Inner pages stay as prompts — generate them later if you like the cover."
                />
                <PreviewModeCard
                  selected={previewMode === 'full'}
                  onClick={() => setPreviewMode('full')}
                  label="All images"
                  time={`~${Math.max(2, Math.ceil((pageCount + 1) * 20 / 60))} min`}
                  cost={fullModeCostLabel(pageCount)}
                  description={`Story + cover + every page illustrated up front (${pageCount} pages).`}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                {laterClickCostNote()}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                After your book is created, you can generate a portrait per cast member for
                consistent characters across pages. {portraitStepCostNote(1 + antagonists.length)}
              </p>
            </div>

            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-2xl p-4 mt-4">
              <h3 className="font-bold text-purple-800 dark:text-purple-300 font-display mb-2">Your Book</h3>
              <div className="text-sm text-purple-700 dark:text-purple-300 space-y-1">
                <p><span className="font-semibold">Theme:</span> <span className="capitalize">{effectiveTheme}</span></p>
                <p><span className="font-semibold">Art style:</span> {STYLE_PRESETS.find(s => s.value === stylePreset)?.label}</p>
                <p><span className="font-semibold">Cast:</span> {cast.map(c => c.name).filter(Boolean).join(', ') || '(none yet)'}</p>
                <p><span className="font-semibold">Ages:</span> {ageRange}</p>
                <p><span className="font-semibold">Pages:</span> {pageCount}</p>
                {additionalDetails && <p><span className="font-semibold">Details:</span> {additionalDetails}</p>}
              </div>
            </div>

            {!user && (
              <div className="bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 p-4 rounded-xl mt-4">
                <p className="font-semibold">Sign in to generate your story</p>
                <p className="text-sm mt-1">
                  Generating a story uses paid AI, so it's limited to signed-in accounts. Your
                  choices here are kept — <Link to="/login" className="underline font-semibold">sign in</Link> and come right back.
                </p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 rounded-xl mt-4">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-8">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => s - 1)}
              className="px-6 py-2 min-h-[44px] sm:min-h-0 rounded-xl font-semibold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            >
              Back
            </button>
          ) : <div />}

          {step < 3 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed()}
              className="px-6 py-2 min-h-[44px] sm:min-h-0 rounded-xl font-semibold bg-purple-500 text-white hover:bg-purple-600 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => void handleGenerate()}
              disabled={!user}
              title={!user ? 'Sign in to generate a story' : undefined}
              className="flex items-center justify-center gap-2 px-6 sm:px-8 py-3 rounded-xl font-bold bg-purple-500 hover:bg-purple-600 text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:shadow-none"
            >
              <Wand2 size={18} />
              Generate My Story
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface CharacterRowProps {
  character: DraftCharacter;
  label: string;
  accent: 'purple' | 'red' | 'amber';
  showRelationship?: boolean;
  onChange: (patch: Partial<DraftCharacter>) => void;
  onRemove?: () => void;
}

const ACCENT_CLASSES: Record<CharacterRowProps['accent'], string> = {
  purple: 'border-purple-200 dark:border-purple-800/60 bg-purple-50/40 dark:bg-purple-900/10',
  red: 'border-red-200 dark:border-red-800/60 bg-red-50/40 dark:bg-red-900/10',
  amber: 'border-amber-200 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-900/10',
}

function CharacterRow({ character, label, accent, showRelationship, onChange, onRemove }: CharacterRowProps) {
  return (
    <div className={`rounded-2xl border-2 p-4 ${ACCENT_CLASSES[accent]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
        {onRemove && (
          <button
            onClick={onRemove}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 text-gray-400 hover:text-red-500 cursor-pointer bg-transparent border-none p-1"
            aria-label="Remove character"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          value={character.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ name: e.target.value })}
          placeholder="Name (e.g., Luna)"
          maxLength={50}
          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:border-purple-400 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500"
        />
        {showRelationship ? (
          <select
            value={character.relationship || 'best friend'}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange({ relationship: e.target.value })}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:border-purple-400 focus:outline-none"
          >
            {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500 self-center">More detail = more consistent illustrations.</span>
        )}
      </div>
      <textarea
        value={character.descriptor || ''}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange({ descriptor: e.target.value })}
        placeholder="Visual descriptor (optional but recommended). Include age, hair color/style, skin tone, distinctive clothing, accessories. Detail helps the same character look the same across pages. e.g., '8-year-old with curly dark hair in two braids, freckles, yellow raincoat, green rain boots'"
        maxLength={400}
        rows={2}
        className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:border-purple-400 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 resize-none leading-snug"
      />
    </div>
  )
}

interface PreviewModeCardProps {
  selected: boolean;
  onClick: () => void;
  label: string;
  time: string;
  cost: string;
  description: string;
}

function PreviewModeCard({ selected, onClick, label, time, cost, description }: PreviewModeCardProps) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-2xl transition-all cursor-pointer border-2 ${
        selected
          ? 'border-pink-500 bg-pink-50 dark:bg-pink-900/30 shadow-md'
          : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:border-pink-200 dark:hover:border-pink-700'
      }`}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-bold text-gray-800 dark:text-gray-100">{label}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{time} · {cost}</span>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug">{description}</p>
    </button>
  )
}
