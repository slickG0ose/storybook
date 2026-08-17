import { CartGetResponseSchema, type CartItem } from '@storybook/shared'

/**
 * Offline cart snapshot, stored in localStorage under its own key.
 *
 * Why an explicit application-level snapshot rather than Workbox runtime-caching of
 * `GET /api/cart/:sessionId`: a cart in the Cache Storage API is keyed by URL, opaque,
 * and outlives a logout on a shared device; it is also invisible to RTL, so the
 * behaviour could only ever be tested through a browser. This module is plain,
 * synchronous, unit-testable, and works before the service worker activates.
 *
 * CLAUDE.md guardrail — the UUID session model is load-bearing. This module NEVER
 * reads-then-writes, rotates, or clears `storybook-session`. It only compares the
 * stored `sessionId` against the live id its caller passes in, and stores everything
 * under a distinct key. A snapshot belonging to a different session is discarded, not
 * adopted.
 */
const CART_CACHE_KEY = 'storybook-cart-cache'

export interface CartSnapshot {
  sessionId: string;
  items: CartItem[];
  total: number;
  cachedAt: string; // ISO
}

/**
 * Returns null on missing/corrupt JSON, schema mismatch, or sessionId mismatch.
 *
 * The `{ items, total }` payload is validated with the same `CartGetResponseSchema`
 * the server's cart route answers with (OPS.3 / ADR-003, reused client-side). A stale
 * cache written by an older build — or one hand-edited in devtools — must not be able
 * to crash the cart page with `item.price.toFixed of undefined`.
 */
export function readCartSnapshot(sessionId: string): CartSnapshot | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(CART_CACHE_KEY)
  } catch {
    // Storage can throw outright (Safari private mode, blocked third-party storage).
    // An unavailable cache is a missing cache, never an error the cart has to handle.
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || record.sessionId !== sessionId) return null
  if (typeof record.cachedAt !== 'string') return null

  const payload = CartGetResponseSchema.safeParse({ items: record.items, total: record.total })
  if (!payload.success) return null

  return {
    sessionId: record.sessionId,
    items: payload.data.items,
    total: payload.data.total,
    cachedAt: record.cachedAt,
  }
}

/** Best-effort write; a full or unavailable quota degrades to "no offline cart". */
export function writeCartSnapshot(snapshot: CartSnapshot): void {
  try {
    localStorage.setItem(CART_CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // QuotaExceededError / SecurityError. Losing the snapshot costs the offline view,
    // not the live cart, so this is deliberately swallowed rather than surfaced.
  }
}

export function clearCartSnapshot(): void {
  try {
    localStorage.removeItem(CART_CACHE_KEY)
  } catch {
    // As above.
  }
}
