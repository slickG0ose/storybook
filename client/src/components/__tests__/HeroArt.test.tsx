import { act, render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { HeroFrame } from '@storybook/shared'
import HeroArt from '../HeroArt'
import { HERO_FADE_MS, HERO_ROTATE_MS } from '../../lib/useHeroPool'

// Pin `api()` to a cross-origin base for the whole file. In dev `VITE_API_BASE_URL` is
// empty, so `api('/hero/x.webp')` and a bare `'/hero/x.webp'` are the same string and a
// test cannot tell whether the component wrapped the path at all. Production is the
// case that matters — GitHub Pages serving the client, Render serving `/hero/*` — so
// the mock makes the wrapping observable.
vi.mock('../../lib/apiBase', () => ({
  API_BASE: 'https://api.test',
  api: (path: string) => `https://api.test${path}`,
}))

// Component-level mirror of the `Home hero art` block in
// `client/src/pages/__tests__/Home.test.tsx`. That block stays as the integration pin —
// it proves the hero survives being rendered inside the real page — and this one gives
// future hero work a local test to run without booting all of `Home`.
//
// HeroArt takes no props and consumes no context, so there is nothing to wrap it in.
describe('HeroArt', () => {
  beforeEach(() => {
    // The pool fetch is fire-and-forget, so these tests would otherwise reach the real
    // `fetch` with a relative URL. Hanging is the honest default here: it is the state
    // the hero spends its first paint in, and it is what a dead backend looks like.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Same selector shape the e2e spec uses: the accessible name comes from `alt`.
  function heroImg() {
    return screen.getByRole('img', { name: /bench/i })
  }

  it('renders the hero illustration with an accessible name', () => {
    render(<HeroArt />)
    expect(heroImg()).toBeInTheDocument()
  })

  it('describes the artwork rather than the product in its alt text', () => {
    render(<HeroArt />)
    const alt = heroImg().getAttribute('alt') ?? ''

    // Mechanical form of the spec's "alt describes the art, not the product" constraint.
    // Word boundaries matter: "backpack" is part of the description and must not trip
    // the `book` case.
    expect(alt).not.toMatch(/\b(AI|book|storybook|create)\b/i)
    expect(alt).toMatch(/bench/i)
  })

  it('reserves its box with intrinsic dimensions', () => {
    render(<HeroArt />)
    const art = heroImg()

    // Paired with `aspect-square` in the class list, these stop the image landing from
    // shifting the fold on a slow connection.
    expect(art).toHaveAttribute('width', '960')
    expect(art).toHaveAttribute('height', '960')
    expect(art.className).toContain('aspect-square')
  })

  it('is eagerly loaded and high priority', () => {
    render(<HeroArt />)
    const art = heroImg()

    // Above the fold: lazy-loading would defer the LCP candidate.
    expect(art.getAttribute('loading')).not.toBe('lazy')
    // React 19 lowercases `fetchPriority` on the way into the DOM.
    expect(art.getAttribute('fetchpriority')).toBe('high')
  })

  it('offers two responsive candidates with a sizes hint', () => {
    render(<HeroArt />)
    const art = heroImg()

    const srcset = art.getAttribute('srcset') ?? ''
    expect(srcset.split(',')).toHaveLength(2)

    // Pinned as shipped. The desktop value deliberately overstates the 420 CSS px the
    // image actually lays out at on a 1440 viewport — it only biases toward the larger
    // candidate, which a 2x display picks anyway. Retune this line if the grid changes.
    expect(art).toHaveAttribute('sizes', '(min-width: 1024px) 440px, 300px')
  })

  it('stacks the image inside a positioned, height-reserved box', () => {
    render(<HeroArt />)

    // The layer that rotation stacks into. Asserted here so the extraction, not the
    // rotation, is what owns the layout — an `absolute inset-0` sibling needs this
    // ancestor to be `relative` and to already reserve its height.
    const layers = heroImg().parentElement
    expect(layers).not.toBeNull()
    expect(layers!.className).toContain('relative')
    expect(layers!.className).toContain('aspect-square')
  })
})

// ---------------------------------------------------------------------------
// Rotation (spec §4, tasks.md Task 7)
//
// The invariant that governs every test below: **frame 0 is never touched.** Its
// `<img>`, its `src` and its accessible name survive the whole session, and rotation
// only ever adds a decorative sibling above it. Everything else here is a way of
// asking that question from a different angle.
// ---------------------------------------------------------------------------

const FRAME_ONE: HeroFrame = {
  id: 'b2fa23cf-p1',
  source: 'pool',
  src: '/hero/b2fa23cf/p1-960.webp',
  src_small: '/hero/b2fa23cf/p1-480.webp',
  width: 960,
  height: 960,
  alt: 'Two children bursting through a bright red door.',
  book_id: 'b2fa23cf',
  book_title: 'A Spot for Sunny',
}

const FRAME_TWO: HeroFrame = {
  ...FRAME_ONE,
  id: 'b2fa23cf-p5',
  src: '/hero/b2fa23cf/p5-960.webp',
  src_small: '/hero/b2fa23cf/p5-480.webp',
  alt: 'A group of children under a wide tree.',
}

type ImageOutcome = 'load' | 'error' | 'hang'

/**
 * jsdom never fires `load` on an `<img>`, so the preload step — and with it the whole
 * rotation — would hang without a stand-in. Installed per test, never globally: "the
 * bytes never arrive" is a real state the component has to handle, and a global fake
 * would make it unreachable.
 */
function installFakeImage(outcome: (src: string) => ImageOutcome = () => 'load'): string[] {
  const requested: string[] = []

  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    sizes = ''
    srcset = ''
    private value = ''

    get src(): string {
      return this.value
    }

    set src(next: string) {
      this.value = next
      requested.push(next)
      const result = outcome(next)
      if (result === 'hang') return
      setTimeout(() => {
        if (result === 'load') this.onload?.()
        else this.onerror?.()
      }, 0)
    }
  }

  vi.stubGlobal('Image', FakeImage)
  return requested
}

function stubPoolResponse(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })),
  )
}

/**
 * Runs the scheduler forward in slices, each inside its own `act`.
 *
 * One long `advanceTimersByTimeAsync` does not work here. React flushes queued renders
 * and effects when `act` *exits*, so the effect that schedules the next timer runs only
 * after the clock has already been pushed to the end of the window — and its timer,
 * scheduled in the past relative to the fake clock, never fires. Slicing lets each
 * commit's timers be picked up by the following slice, which is how the rotation
 * actually behaves against a real clock.
 */
const ADVANCE_STEP_MS = 50

async function advance(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += ADVANCE_STEP_MS) {
    const step = Math.min(ADVANCE_STEP_MS, ms - elapsed)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step)
    })
  }
}

/** Layer 1 is `aria-hidden`, so it is invisible to role queries by design. */
function layers(container: HTMLElement): HTMLImageElement[] {
  return Array.from(container.querySelectorAll('img'))
}

/** Frame 0 — the bundled, named, never-mutated LCP candidate. */
function baseLayer(container: HTMLElement): HTMLImageElement {
  const [frameZero] = layers(container)
  expect(frameZero).toBeDefined()
  return frameZero!
}

/** The rotating layer. Asserts it exists, so callers read as one thought. */
function rotatingLayer(container: HTMLElement): HTMLImageElement {
  const all = layers(container)
  expect(all).toHaveLength(2)
  return all[1]!
}

describe('HeroArt rotation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Deterministic start index unless a test says otherwise.
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('pins the rotation timings so a retune is a deliberate edit', () => {
    expect(HERO_ROTATE_MS).toBe(7000)
    expect(HERO_FADE_MS).toBe(600)
  })

  it('paints frame 0 without waiting for the pool', () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage()

    // No `await` before this assertion, deliberately: the hero must be on screen on the
    // first paint, not one microtask later.
    const { container } = render(<HeroArt />)

    expect(screen.getByRole('img', { name: /bench/i })).toBeInTheDocument()
    expect(layers(container)).toHaveLength(1)
  })

  it('stays on frame 0 when the pool fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    installFakeImage()

    const { container } = render(<HeroArt />)
    // Vitest fails the run on an unhandled rejection, so reaching the end of this test
    // is itself the "no unhandled rejection" assertion.
    await advance(HERO_ROTATE_MS * 2)

    expect(screen.getByRole('img', { name: /bench/i })).toBeInTheDocument()
    expect(layers(container)).toHaveLength(1)
  })

  it('stays on frame 0, with no timer left running, on an empty pool', async () => {
    stubPoolResponse({ frames: [] })
    installFakeImage()

    const { container } = render(<HeroArt />)
    await advance(HERO_ROTATE_MS * 2)

    expect(layers(container)).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('tolerates a body that is not the pool contract at all', async () => {
    // Several existing `fetch` mocks — `Home.test.tsx` among them — answer every call
    // with a bare array. That must fail closed, not throw.
    stubPoolResponse([])
    installFakeImage()

    const { container } = render(<HeroArt />)
    await advance(HERO_ROTATE_MS * 2)

    expect(layers(container)).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fades a pool frame in above frame 0 without touching frame 0', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage()

    const { container } = render(<HeroArt />)
    const frameZeroSrc = baseLayer(container).getAttribute('src')

    await advance(HERO_FADE_MS * 2)

    const rotating = rotatingLayer(container)

    // The whole point: the LCP element is byte-identical before and after.
    expect(baseLayer(container).getAttribute('src')).toBe(frameZeroSrc)

    // Cross-origin path, wrapped by `api()` (spec §4 rule 7).
    expect(rotating.getAttribute('src')).toBe('https://api.test/hero/b2fa23cf/p1-960.webp')
    expect(rotating.getAttribute('srcset')).toBe(
      'https://api.test/hero/b2fa23cf/p1-480.webp 480w, https://api.test/hero/b2fa23cf/p1-960.webp 960w',
    )

    // Stacked, and animating opacity only — no layout property, so CLS is zero by
    // construction rather than by measurement.
    const cls = rotating.className
    expect(cls).toContain('absolute')
    expect(cls).toContain('inset-0')
    expect(cls).toContain('transition-opacity')
    expect(cls).toContain('opacity-100')
    expect(cls).not.toMatch(/\b(scale|translate|rotate|transition-transform)/)
    expect(rotating.style.transitionDuration).toBe(`${HERO_FADE_MS}ms`)
  })

  it('leaves exactly one accessibly-named image after a rotation', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage()

    const { container } = render(<HeroArt />)
    await advance(HERO_ROTATE_MS * 2)

    // Two elements in the DOM, one name in the accessibility tree. This is what keeps
    // the three pinned `/bench/i` selectors deterministic (spec §Alternatives).
    expect(layers(container)).toHaveLength(2)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: /bench/i })).toBeInTheDocument()

    const rotating = rotatingLayer(container)
    expect(rotating.getAttribute('alt')).toBe('')
    expect(rotating.getAttribute('aria-hidden')).toBe('true')
  })

  it('advances to the next frame after the dwell', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage()

    const { container } = render(<HeroArt />)
    await advance(HERO_FADE_MS * 2)
    expect(rotatingLayer(container).getAttribute('src')).toContain('p1-960.webp')

    // Dwell, then fade out, swap, fade in.
    await advance(HERO_ROTATE_MS + HERO_FADE_MS * 3)

    expect(rotatingLayer(container).getAttribute('src')).toContain('p5-960.webp')
    expect(baseLayer(container).getAttribute('alt')).toMatch(/bench/i)
  })

  it('picks its start index at random', async () => {
    // 0.9 * 2 frames floors to index 1 — the second frame leads, not the first.
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage()

    const { container } = render(<HeroArt />)
    await advance(HERO_FADE_MS * 2)

    expect(rotatingLayer(container).getAttribute('src')).toContain('p5-960.webp')
  })

  it('skips a frame whose bytes never load rather than showing it blank', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage((src) => (src.includes('p1-960') ? 'error' : 'load'))

    const { container } = render(<HeroArt />)
    await advance(HERO_FADE_MS * 2)

    // The broken frame is never swapped in; the pool moves on to the next one.
    expect(rotatingLayer(container).getAttribute('src')).toContain('p5-960.webp')
  })

  it('stops rather than spinning when every frame is unreachable', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage(() => 'error')

    const { container } = render(<HeroArt />)
    await advance(HERO_ROTATE_MS * 3)

    expect(layers(container)).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds while the tab is in the background', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage()

    let visibility: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })

    try {
      const { container } = render(<HeroArt />)
      await advance(HERO_ROTATE_MS * 2)

      // Bytes may be warm, but nothing is shown to an empty room.
      expect(layers(container)).toHaveLength(1)

      visibility = 'visible'
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(HERO_FADE_MS * 2)
      })

      expect(layers(container)).toHaveLength(2)
    } finally {
      Reflect.deleteProperty(document, 'visibilityState')
    }
  })

  it('suppresses rotation under prefers-reduced-motion: reduce', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    const requested = installFakeImage()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))

    const { container } = render(<HeroArt />)
    await advance(HERO_ROTATE_MS * 2)

    expect(layers(container)).toHaveLength(1)
    // Suppressed before the request, not after: a visitor who asked for less motion
    // does not pay for a list they will never see.
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(requested).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('suppresses rotation under navigator.connection.saveData', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    const requested = installFakeImage()
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    })

    try {
      const { container } = render(<HeroArt />)
      await advance(HERO_ROTATE_MS * 2)

      expect(layers(container)).toHaveLength(1)
      expect(globalThis.fetch).not.toHaveBeenCalled()
      expect(requested).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      Reflect.deleteProperty(navigator, 'connection')
    }
  })

  it('sends no Authorization header — the pool is the same for everyone', async () => {
    stubPoolResponse({ frames: [FRAME_ONE, FRAME_TWO] })
    installFakeImage()

    render(<HeroArt />)
    await advance(HERO_FADE_MS)

    // The client half of the consent seam (spec §3). The server-side tripwire is the
    // auth-invariance test in `server/src/routes/__tests__/hero.test.ts`; this one
    // catches the mistake one layer earlier, where the temptation to "just pass the
    // token along" actually lives.
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.test/api/hero/pool')
  })
})
