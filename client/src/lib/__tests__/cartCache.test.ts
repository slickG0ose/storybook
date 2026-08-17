import { describe, it, expect, beforeEach } from 'vitest'
import type { CartItem } from '@storybook/shared'
import { readCartSnapshot, writeCartSnapshot, clearCartSnapshot, type CartSnapshot } from '../cartCache'

const CART_CACHE_KEY = 'storybook-cart-cache'
const SESSION_KEY = 'storybook-session'
const SESSION_ID = '11111111-2222-3333-4444-555555555555'

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 1,
    book_id: 'book-1',
    quantity: 2,
    title: 'The Brave Little Fox',
    price: 12.99,
    cover_emoji: '🦊',
    cover_color: '#ff6600',
    author: 'AI Author',
    ...overrides,
  }
}

function snapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
  return {
    sessionId: SESSION_ID,
    items: [item()],
    total: 25.98,
    cachedAt: '2026-08-16T10:00:00.000Z',
    ...overrides,
  }
}

describe('cartCache', () => {
  beforeEach(() => {
    localStorage.clear()
    // The live session UUID is present for every case below, so any write to it by the
    // cache module would be visible as a changed value rather than a created key.
    localStorage.setItem(SESSION_KEY, SESSION_ID)
  })

  it('round-trips a snapshot for the matching session', () => {
    const written = snapshot()
    writeCartSnapshot(written)

    expect(readCartSnapshot(SESSION_ID)).toEqual(written)
  })

  it('returns null when nothing has been cached', () => {
    expect(readCartSnapshot(SESSION_ID)).toBeNull()
  })

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(CART_CACHE_KEY, '{ not json at all')

    expect(readCartSnapshot(SESSION_ID)).toBeNull()
  })

  it('returns null when the snapshot belongs to a different session', () => {
    writeCartSnapshot(snapshot({ sessionId: 'a-different-session' }))

    expect(readCartSnapshot(SESSION_ID)).toBeNull()
  })

  it('returns null when the payload fails CartGetResponseSchema', () => {
    // `price` as a string is exactly the drift a hand-edited or stale-build cache
    // produces, and it is what would crash Cart.tsx's `price.toFixed(2)`.
    localStorage.setItem(
      CART_CACHE_KEY,
      JSON.stringify({
        sessionId: SESSION_ID,
        items: [{ ...item(), price: '12.99' }],
        total: 25.98,
        cachedAt: '2026-08-16T10:00:00.000Z',
      }),
    )

    expect(readCartSnapshot(SESSION_ID)).toBeNull()
  })

  it('returns null when a required CartItem field is missing', () => {
    const { title: _title, ...withoutTitle } = item()
    localStorage.setItem(
      CART_CACHE_KEY,
      JSON.stringify({
        sessionId: SESSION_ID,
        items: [withoutTitle],
        total: 25.98,
        cachedAt: '2026-08-16T10:00:00.000Z',
      }),
    )

    expect(readCartSnapshot(SESSION_ID)).toBeNull()
  })

  it('returns null when cachedAt is missing', () => {
    localStorage.setItem(
      CART_CACHE_KEY,
      JSON.stringify({ sessionId: SESSION_ID, items: [item()], total: 25.98 }),
    )

    expect(readCartSnapshot(SESSION_ID)).toBeNull()
  })

  it('clearCartSnapshot removes the key', () => {
    writeCartSnapshot(snapshot())
    expect(localStorage.getItem(CART_CACHE_KEY)).not.toBeNull()

    clearCartSnapshot()

    expect(localStorage.getItem(CART_CACHE_KEY)).toBeNull()
    expect(readCartSnapshot(SESSION_ID)).toBeNull()
  })

  // CLAUDE.md guardrail: the UUID session model is load-bearing. This module lives next
  // door to `storybook-session` and must never touch it — not on read, not on write, not
  // on clear, and not when it rejects a snapshot from another session (the tempting bug
  // is "adopt the cached id"). Asserted after every operation, not just one.
  it('never writes storybook-session', () => {
    const operations: [string, () => void][] = [
      ['read (empty cache)', () => void readCartSnapshot(SESSION_ID)],
      ['write', () => writeCartSnapshot(snapshot())],
      ['read (hit)', () => void readCartSnapshot(SESSION_ID)],
      ['read (session mismatch)', () => void readCartSnapshot('some-other-session')],
      ['write (foreign session)', () => writeCartSnapshot(snapshot({ sessionId: 'foreign' }))],
      ['read (corrupt)', () => {
        localStorage.setItem(CART_CACHE_KEY, 'not json')
        readCartSnapshot(SESSION_ID)
      }],
      ['clear', () => clearCartSnapshot()],
    ]

    for (const [label, run] of operations) {
      run()
      expect(localStorage.getItem(SESSION_KEY), `${label} changed storybook-session`).toBe(SESSION_ID)
    }
  })

  it('does not create storybook-session when the key is absent', () => {
    localStorage.removeItem(SESSION_KEY)

    writeCartSnapshot(snapshot())
    readCartSnapshot(SESSION_ID)
    clearCartSnapshot()

    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})
