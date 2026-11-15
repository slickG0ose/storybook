import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CREATE_DRAFT_KEY, loadCreateDraft, saveCreateDraft, clearCreateDraft } from '../createDraft'
import type { CreateDraft } from '../createDraft'

const DRAFT: CreateDraft = {
  v: 1,
  step: 2,
  theme: 'adventure',
  customTheme: '',
  stylePreset: 'storybook',
  cast: [{ role: 'primary', name: 'Luna', descriptor: 'curly hair' }],
  ageRange: '3-5',
  additionalDetails: '',
  previewMode: 'quick',
  pageCount: 5,
  styleReferenceUrl: '',
  customStyleDescriptor: '',
}

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('createDraft', () => {
  it('round-trips a draft and clears it', () => {
    saveCreateDraft(DRAFT)
    expect(loadCreateDraft()).toEqual(DRAFT)
    clearCreateDraft()
    expect(sessionStorage.getItem(CREATE_DRAFT_KEY)).toBeNull()
  })

  it('returns null on a missing key', () => {
    expect(loadCreateDraft()).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    sessionStorage.setItem(CREATE_DRAFT_KEY, '{nope')
    expect(loadCreateDraft()).toBeNull()
  })

  it('returns null on a different version', () => {
    sessionStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify({ ...DRAFT, v: 2 }))
    expect(loadCreateDraft()).toBeNull()
  })

  it('returns null when a field has the wrong type', () => {
    sessionStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify({ ...DRAFT, pageCount: '5' }))
    expect(loadCreateDraft()).toBeNull()
    sessionStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify({ ...DRAFT, cast: [{ role: 'primary', name: 7 }] }))
    expect(loadCreateDraft()).toBeNull()
  })

  it('save does not throw when sessionStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveCreateDraft(DRAFT)).not.toThrow()
  })
})
