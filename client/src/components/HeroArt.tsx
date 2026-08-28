import { useEffect, useRef, useState } from 'react'
import type { HeroFrame } from '@storybook/shared'
import heroArt960 from '../assets/hero/spot-for-sunny-bench-960.webp'
import heroArt480 from '../assets/hero/spot-for-sunny-bench-480.webp'
import { api } from '../lib/apiBase'
import { HERO_FADE_MS, HERO_ROTATE_MS, useHeroPool } from '../lib/useHeroPool'

// Describes the artwork, not the product: the hero image is a page from a real
// seeded book, so its alt text is what a sighted reader sees, not a sales line.
export const HERO_ALT =
  'Watercolour illustration of two young girls sitting side by side on a wooden bench ' +
  'under a leafy tree, an orange backpack between them, one turning to greet the other.'

/**
 * Mirrors frame 0's `sizes` verbatim. The *pin* on that value lives on layer 0
 * (`Home.test.tsx`) and must not move here — this copy exists so the rotating layer
 * picks the same candidate as the frame it fades over, and so the preload requests
 * the file the `<img>` will actually use.
 */
const ROTATING_SIZES = '(min-width: 1024px) 440px, 300px'

/**
 * How far ahead of the swap the next frame's bytes are requested. Sits inside the
 * dwell, so a slow image delays nothing that is on screen.
 */
const PRELOAD_LEAD_MS = 1000

/** A frame that has not loaded by now is treated as broken and skipped. */
const PRELOAD_TIMEOUT_MS = 5000

/**
 * One paint between mounting a frame at `opacity-0` and flipping it to `opacity-100`.
 * A CSS transition needs a previously-computed value to animate *from*; React batches
 * the two state updates into a single commit without this gap, and the frame pops in
 * instead of fading.
 */
const SWAP_TICK_MS = 32

function srcSetFor(frame: HeroFrame): string {
  // 480 is fixed by the derivation contract; the large candidate carries its intrinsic
  // width on the wire.
  return `${api(frame.src_small)} 480w, ${api(frame.src)} ${frame.width}w`
}

/**
 * The Home hero's art column (#127).
 *
 * The illustration is an opaque square on pale cream paper: on the cream surface it
 * blends at the edges, but on gray-900 it would butt a bright square against near-black
 * and glare. The mat carries the app's existing card language so the art reads as a page
 * from a book and gets a mid-tone surround in dark mode — no filter on the image itself,
 * which is the one thing the hero exists to show off.
 *
 * Layer 0 is the LCP candidate. Its `<img>`, its `src`, and its attributes are never
 * mutated — rotation adds a sibling layer above it rather than re-`src`ing this one.
 * See `.code-captain/specs/hero-rotation/spec.md` §4.
 *
 * **Exactly one `<img>` here is ever accessibly named.** Layer 0 keeps `HERO_ALT`;
 * every rotating frame is `alt=""` + `aria-hidden`. That is an accepted a11y cost, not
 * an oversight: a screen-reader user hears frame 0's description while a different
 * frame is on screen. It is defensible only because the rotation is decorative variety
 * with no caption, no link, and no information the page needs — and it stops being
 * defensible the moment attribution is added, which is why attribution is out of scope.
 * Three pinned `/bench/i` selectors (`Home.test.tsx`, `e2e/tests/home.spec.ts`,
 * `e2e/tests/mobile/hero.spec.ts`) depend on this rule holding.
 */
export default function HeroArt() {
  const { frames } = useHeroPool()

  // The frame currently on layer 1, or null while the hero is just frame 0.
  const [shown, setShown] = useState<HeroFrame | null>(null)
  const [visible, setVisible] = useState(false)
  // Survives StrictMode's dev-only effect remount, so the first fade-in is not replayed.
  const hasShownRef = useRef(false)

  useEffect(() => {
    // The empty pool is the designed default, not a failure — see `useHeroPool`.
    if (frames.length === 0) return

    let cancelled = false
    const timers = new Set<number>()
    const listeners = new Set<() => void>()

    const sleep = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(() => {
          timers.delete(id)
          resolve()
        }, ms)
        timers.add(id)
      })

    /** Resolves immediately unless the tab is in the background. */
    const whenTabVisible = (): Promise<void> => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        const onChange = (): void => {
          if (document.visibilityState === 'hidden') return
          document.removeEventListener('visibilitychange', onChange)
          listeners.delete(onChange)
          resolve()
        }
        document.addEventListener('visibilitychange', onChange)
        listeners.add(onChange)
      })
    }

    /**
     * Fetches a frame's bytes into cache. Resolves `false` for an image that errors or
     * never arrives, so a broken frame is skipped rather than swapped in blank.
     */
    const preload = (frame: HeroFrame): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        const img = new Image()
        let timeout: number | undefined
        let settled = false

        const settle = (ok: boolean): void => {
          if (settled) return
          settled = true
          img.onload = null
          img.onerror = null
          if (timeout !== undefined) {
            window.clearTimeout(timeout)
            timers.delete(timeout)
          }
          resolve(ok)
        }

        img.onload = () => settle(true)
        img.onerror = () => settle(false)
        // Same `sizes`/`srcset` pair the rendered layer uses, so the candidate the
        // browser warms is the candidate it will display.
        img.sizes = ROTATING_SIZES
        img.srcset = srcSetFor(frame)
        img.src = api(frame.src)

        timeout = window.setTimeout(() => settle(false), PRELOAD_TIMEOUT_MS)
        timers.add(timeout)
      })

    /**
     * With two layers, the bundled frame *is* the other half of the crossfade: layer 1
     * dissolves out to reveal frame 0, swaps its already-cached `src` while invisible,
     * and dissolves back in. Only `opacity` is ever animated, so CLS stays zero by
     * construction rather than by measurement.
     */
    const crossfadeTo = async (frame: HeroFrame): Promise<void> => {
      if (hasShownRef.current) {
        setVisible(false)
        await sleep(HERO_FADE_MS)
        if (cancelled) return
      }
      setShown(frame)
      hasShownRef.current = true
      await sleep(SWAP_TICK_MS)
      if (cancelled) return
      setVisible(true)
      await sleep(HERO_FADE_MS)
    }

    // `frames` is non-empty (guarded above) and every index is taken modulo its
    // length, so this cannot miss — `noUncheckedIndexedAccess` just cannot see that.
    const frameAt = (i: number): HeroFrame => frames[i % frames.length]!

    const run = async (): Promise<void> => {
      // Variety without defeating the HTTP cache: the server's order is deterministic
      // and cached for 300 s, so the client picks where to *enter* it instead.
      let index = Math.floor(Math.random() * frames.length)
      let strikes = 0

      // Frame 0 is already painted, so the first pool frame's bytes can start now —
      // there is no dwell to hide them behind.
      let pending = preload(frameAt(index))

      while (!cancelled) {
        const frame = frameAt(index)
        const loaded = await pending
        if (cancelled) return

        if (!loaded) {
          strikes += 1
          // The whole pool is unreachable (server down, files missing). Stop, rather
          // than spin through a dead list forever.
          if (strikes >= frames.length) return
          index = (index + 1) % frames.length
          pending = preload(frameAt(index))
          continue
        }
        strikes = 0

        await whenTabVisible()
        if (cancelled) return

        await crossfadeTo(frame)
        if (cancelled) return

        // Dwell, split so the next frame is requested PRELOAD_LEAD_MS before the swap.
        await sleep(Math.max(0, HERO_ROTATE_MS - PRELOAD_LEAD_MS))
        if (cancelled) return
        index = (index + 1) % frames.length
        pending = preload(frameAt(index))
        await sleep(Math.min(HERO_ROTATE_MS, PRELOAD_LEAD_MS))
        if (cancelled) return
        // Hold the current frame while the tab is in the background rather than
        // burning through the pool, and its bytes, into an empty room.
        await whenTabVisible()
      }
    }

    void run()

    return () => {
      cancelled = true
      for (const id of timers) window.clearTimeout(id)
      timers.clear()
      for (const fn of listeners) document.removeEventListener('visibilitychange', fn)
      listeners.clear()
    }
  }, [frames])

  return (
    <div className="w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[440px] justify-self-center lg:justify-self-end lg:mt-4">
      <div className="p-2 sm:p-2.5 bg-white dark:bg-gray-800 rounded-[24px] shadow-card ring-1 ring-gray-200 dark:ring-gray-700">
        {/* The positioning context every future layer stacks into. It lives here so the
            rotation commit adds no layout of its own — and `aspect-square` stays on the
            `<img>` as well, because that is what the intrinsic `width`/`height` pin is
            paired with. */}
        <div className="relative aspect-square">
          {/* Frame 0. No `loading="lazy"`: this is above the fold and is the LCP
              candidate. `width`/`height` plus `aspect-square` reserve the box before the
              bytes land, so nothing shifts on a slow connection. */}
          <img
            src={heroArt960}
            srcSet={`${heroArt480} 480w, ${heroArt960} 960w`}
            sizes="(min-width: 1024px) 440px, 300px"
            width={960}
            height={960}
            alt={HERO_ALT}
            decoding="async"
            fetchPriority="high"
            className="w-full aspect-square object-cover rounded-[16px]"
          />
          {/* Layer 1 — the rotating frame. Decorative by design (see the component
              comment), so it carries no accessible name and no pointer target. It adds
              positioning and opacity only: no colour class, hence no `dark:` partner,
              and no layout property that could shift the fold. */}
          {shown && (
            <img
              src={api(shown.src)}
              srcSet={srcSetFor(shown)}
              sizes={ROTATING_SIZES}
              width={shown.width}
              height={shown.height}
              alt=""
              aria-hidden="true"
              decoding="async"
              className={`absolute inset-0 h-full w-full object-cover rounded-[16px] pointer-events-none transition-opacity motion-reduce:transition-none ${
                visible ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ transitionDuration: `${HERO_FADE_MS}ms` }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
