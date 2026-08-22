import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  readPrefs,
  writePrefs,
  DEFAULT_PREFS,
  RATE_OPTIONS,
  MIN_RATE,
  MAX_RATE,
  type NarrationPrefs,
} from '../prefs'

const NARRATION_KEY = 'storybook-narration'

// Every other key the app owns. None of them may be read or written by this module —
// the session UUID model in particular is a CLAUDE.md guardrail.
const FOREIGN_KEYS = {
  'storybook-session': '11111111-2222-3333-4444-555555555555',
  'storybook-auth': 'a-token',
  'storybook-theme': 'dark',
  'storybook-cart-cache': '{"items":[]}',
}

describe('narration prefs', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const [key, value] of Object.entries(FOREIGN_KEYS)) localStorage.setItem(key, value)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips a full preference blob', () => {
    const prefs: NarrationPrefs = { voiceURI: 'urn:voice:samantha', rate: 1.25, autoAdvance: false }
    writePrefs(prefs)

    expect(readPrefs()).toEqual(prefs)
  })

  it('returns defaults when the key is missing', () => {
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('returns defaults on malformed JSON', () => {
    localStorage.setItem(NARRATION_KEY, '{ not json at all')

    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('returns defaults when the blob is not an object', () => {
    localStorage.setItem(NARRATION_KEY, '"just a string"')
    expect(readPrefs()).toEqual(DEFAULT_PREFS)

    localStorage.setItem(NARRATION_KEY, '[1,2,3]')
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('clamps an out-of-range rate', () => {
    localStorage.setItem(
      NARRATION_KEY,
      JSON.stringify({ voiceURI: null, rate: 99, autoAdvance: true }),
    )
    expect(readPrefs().rate).toBe(MAX_RATE)

    localStorage.setItem(
      NARRATION_KEY,
      JSON.stringify({ voiceURI: null, rate: 0.1, autoAdvance: true }),
    )
    expect(readPrefs().rate).toBe(MIN_RATE)
  })

  it('falls back per field: a bad rate does not discard the other fields', () => {
    localStorage.setItem(
      NARRATION_KEY,
      JSON.stringify({ voiceURI: 'urn:voice:daniel', rate: 'fast', autoAdvance: false }),
    )

    expect(readPrefs()).toEqual({
      voiceURI: 'urn:voice:daniel',
      rate: DEFAULT_PREFS.rate,
      autoAdvance: false,
    })
  })

  it('falls back per field for voiceURI and autoAdvance too', () => {
    localStorage.setItem(
      NARRATION_KEY,
      JSON.stringify({ voiceURI: 42, rate: 1.5, autoAdvance: 'yes' }),
    )

    expect(readPrefs()).toEqual({ voiceURI: null, rate: 1.5, autoAdvance: DEFAULT_PREFS.autoAdvance })
  })

  it('ignores unknown extra keys', () => {
    localStorage.setItem(
      NARRATION_KEY,
      JSON.stringify({ voiceURI: null, rate: 1, autoAdvance: true, pitch: 3, legacyMode: 'on' }),
    )

    expect(readPrefs()).toEqual(DEFAULT_PREFS)
    expect(Object.keys(readPrefs()).sort()).toEqual(['autoAdvance', 'rate', 'voiceURI'])
  })

  it('offers exactly the four supported rates, all inside the clamp range', () => {
    expect(RATE_OPTIONS).toEqual([0.75, 1, 1.25, 1.5])
    for (const rate of RATE_OPTIONS) {
      expect(rate).toBeGreaterThanOrEqual(MIN_RATE)
      expect(rate).toBeLessThanOrEqual(MAX_RATE)
    }
  })

  // Safari private mode and some embedded webviews throw outright. A reader that crashes
  // because a preference could not be saved is worse than a lost preference.
  it('does not propagate a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })

    expect(() => writePrefs({ voiceURI: null, rate: 1, autoAdvance: true })).not.toThrow()
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  // CLAUDE.md guardrail: narration state lives under exactly one new key. This module
  // must never read, write, rotate, or reinterpret any other `storybook-*` key.
  it('reads and writes only storybook-narration', () => {
    localStorage.setItem(NARRATION_KEY, JSON.stringify({ voiceURI: 'v', rate: 9, autoAdvance: 1 }))

    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    const clear = vi.spyOn(Storage.prototype, 'clear')

    readPrefs()
    writePrefs({ voiceURI: 'urn:voice:kanya', rate: 1.25, autoAdvance: false })
    readPrefs()

    expect(getItem).toHaveBeenCalled()
    expect(setItem).toHaveBeenCalled()
    for (const call of [...getItem.mock.calls, ...setItem.mock.calls, ...removeItem.mock.calls]) {
      expect(call[0]).toBe(NARRATION_KEY)
    }
    expect(clear).not.toHaveBeenCalled()

    vi.restoreAllMocks()
    for (const [key, value] of Object.entries(FOREIGN_KEYS)) {
      expect(localStorage.getItem(key), `${key} was modified`).toBe(value)
    }
  })
})
