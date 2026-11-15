import type { CharacterRole } from '../types'

// Create-a-Book wizard draft, kept across the sign-in bounce (#210, Owner decision 5).
// sessionStorage, not localStorage: it holds a child's name and must not outlive the tab.
export const CREATE_DRAFT_KEY = 'storybook-create-draft'

export interface CreateDraftCharacter {
  role: CharacterRole
  name: string
  descriptor?: string
  relationship?: string
}

export interface CreateDraft {
  v: 1
  step: number
  theme: string
  customTheme: string
  stylePreset: string
  cast: CreateDraftCharacter[]
  ageRange: string
  additionalDetails: string
  previewMode: 'quick' | 'cover' | 'full'
  pageCount: number
  styleReferenceUrl: string
  customStyleDescriptor: string
}

const isStr = (x: unknown): x is string => typeof x === 'string'
const isOptStr = (x: unknown): boolean => x === undefined || typeof x === 'string'

function isValidDraft(d: unknown): d is CreateDraft {
  if (typeof d !== 'object' || d === null) return false
  const o = d as Record<string, unknown>
  if (o.v !== 1) return false
  if (typeof o.step !== 'number' || !Number.isInteger(o.step) || o.step < 1 || o.step > 3) return false
  if (!isStr(o.theme) || !isStr(o.customTheme) || !isStr(o.stylePreset)) return false
  if (!isStr(o.ageRange) || !isStr(o.additionalDetails)) return false
  if (!isStr(o.styleReferenceUrl) || !isStr(o.customStyleDescriptor)) return false
  if (o.previewMode !== 'quick' && o.previewMode !== 'cover' && o.previewMode !== 'full') return false
  if (typeof o.pageCount !== 'number' || !Number.isFinite(o.pageCount)) return false
  if (!Array.isArray(o.cast)) return false
  return o.cast.every(c => {
    if (typeof c !== 'object' || c === null) return false
    const m = c as Record<string, unknown>
    return isStr(m.role) && isStr(m.name) && isOptStr(m.descriptor) && isOptStr(m.relationship)
  })
}

/** Returns null on a missing key, bad JSON, wrong `v`, or any field of the wrong type. Never throws. */
export function loadCreateDraft(): CreateDraft | null {
  try {
    const raw = sessionStorage.getItem(CREATE_DRAFT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isValidDraft(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Swallows quota and access errors. */
export function saveCreateDraft(draft: CreateDraft): void {
  try {
    sessionStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Draft persistence is best-effort.
  }
}

export function clearCreateDraft(): void {
  try {
    sessionStorage.removeItem(CREATE_DRAFT_KEY)
  } catch {
    // ignore
  }
}
