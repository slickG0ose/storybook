import { useEffect, useState } from 'react'
import { HeroPoolResponseSchema, type HeroFrame } from '@storybook/shared'
import { api } from './apiBase'

/**
 * The Home hero's rotation pool (#127, spec `.code-captain/specs/hero-rotation/`).
 *
 * This hook is deliberately unopinionated about *rendering*: it answers one question —
 * "are there any frames this visitor should rotate through?" — and answers `[]` for
 * every reason not to rotate, so the component has a single condition to branch on
 * rather than four.
 *
 * It is also deliberately ignorant of who is asking. No auth read, no bearer token, no
 * context. That absence is the client half of the consent seam (spec §3): the pool is
 * byte-identical for every visitor, and the moment this hook learns about the signed-in
 * user is the moment one reader's art can reach another reader's screen.
 */

/** Dwell time on each rotating frame, in ms. */
export const HERO_ROTATE_MS = 7000

/** Crossfade duration, in ms. Drives the CSS transition on the rotating layer. */
export const HERO_FADE_MS = 600

/**
 * A child's effect runs before its parent's, so an un-deferred fetch here would be
 * issued *ahead* of the storefront's own `/api/books` call. The pool is progressive
 * enhancement — it must never queue in front of the catalog on a cold connection — so
 * the request is pushed out of the mount task entirely.
 */
const POOL_FETCH_DEFER_MS = 0

/** `navigator.connection` is not in lib.dom; only `saveData` is read here. */
interface NavigatorWithConnection extends Navigator {
  connection?: { saveData?: boolean }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // A matchMedia that throws on an unsupported query is not a reason to animate.
    return true
  }
}

function saveDataEnabled(): boolean {
  if (typeof navigator === 'undefined') return false
  return (navigator as NavigatorWithConnection).connection?.saveData === true
}

/**
 * Narrows the response, or returns `[]`.
 *
 * Validated with the same `HeroPoolResponseSchema` the server answers with — OPS.3 /
 * ADR-003 reused client-side, the way `cartCache.ts` reuses `CartGetResponseSchema`.
 * The schema is the contract; this is the client declining to render a shape it did
 * not agree to, and it means a wire change breaks here rather than three renders later
 * in `frame.src.startsWith`.
 *
 * It also has to survive a body that is not the contract at all. A bare `[]` — which
 * is what several existing `fetch` mocks return for *every* call — has no `frames`
 * key, so it fails the parse and lands on the empty path rather than throwing.
 */
function readHeroPool(body: unknown): HeroFrame[] {
  const parsed = HeroPoolResponseSchema.safeParse(body)
  // A malformed frame means the contract moved. Suppress the whole rotation rather
  // than render a partial pool built on a shape we no longer understand.
  return parsed.success ? parsed.data.frames : []
}

/**
 * Returns `[]` whenever rotation must be suppressed: fetch failure, a non-2xx, a
 * malformed body, an empty pool, `prefers-reduced-motion: reduce`, or
 * `navigator.connection?.saveData`. Never throws, never suspends, never reads auth
 * state, never sends an Authorization header.
 *
 * `[]` is not an error state the caller has to handle — it is the designed default.
 * The hero on `[]` is exactly today's static hero, which is what a visitor with a dead
 * backend, a cold Render instance, or an offline PWA gets (spec §1).
 */
export function useHeroPool(): { frames: HeroFrame[] } {
  const [frames, setFrames] = useState<HeroFrame[]>([])

  useEffect(() => {
    // Checked before the request is even scheduled: a visitor who has asked for less
    // motion or less data should not pay for a list they will never see.
    if (prefersReducedMotion() || saveDataEnabled()) return

    let cancelled = false

    const load = async (): Promise<void> => {
      try {
        // No headers, on purpose. See the module comment.
        const res = await fetch(api('/api/hero/pool'))
        if (!res.ok) return
        const body: unknown = await res.json()
        const pool = readHeroPool(body)
        if (!cancelled && pool.length > 0) setFrames(pool)
      } catch {
        // Fail closed. Every failure mode — offline, CORS, a 502 from a sleeping
        // Render instance, invalid JSON — is the same outcome: no rotation, frame 0.
      }
    }

    const timer = window.setTimeout(() => void load(), POOL_FETCH_DEFER_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  return { frames }
}
