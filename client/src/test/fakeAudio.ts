/**
 * An installable fake `HTMLAudioElement` (`window.Audio`) for jsdom.
 *
 * **Install it explicitly, per test file — never globally in `setup.ts`** (the same rule
 * as `fakeSpeech.ts`, `docs/conventions/client.md`). jsdom's own `Audio` exists but its
 * `play()` is "not implemented", so a test that forgets to install this one fails loudly
 * instead of passing against a silent element.
 *
 * Deliberately dumb: `play()` resolves, then `playing` fires after 0 ms and `ended` after
 * `clipMs`, all on timers. It is *our model* of the media element, not the element — in
 * particular, setting `src` cancels pending events (a real load does too) but does not
 * reject an in-flight `play()` promise with `AbortError`. `generatedProvider.test.ts` is
 * where that model is pinned.
 *
 * Use with `vi.useFakeTimers()`.
 */

export interface FakeAudioOptions {
  /** Simulated ms from `playing` to `ended` for every source. Default 100. */
  clipMs?: number
}

export interface FakeAudioControl {
  /** Every element constructed while installed, in creation order. */
  instances(): FakeAudioElement[]
  /** Make the next `play()` call (on any element) reject with a `DOMException` of this name. */
  rejectNextPlay(name: string): void
  /** Fire `error` on the element and stop it, like a clip that failed to load. */
  failCurrent(element: FakeAudioElement): void
}

type Handler = ((event: Event) => void) | null

export class FakeAudioElement extends EventTarget {
  /** Every `src` ever assigned, in order — the playback assertion surface. */
  readonly srcHistory: string[] = []
  playCalls = 0
  paused = true
  preload = 'auto'
  playbackRate = 1
  defaultPlaybackRate = 1
  currentTime = 0
  onplaying: Handler = null
  onended: Handler = null
  onerror: Handler = null
  onpause: Handler = null

  private srcValue = ''
  private timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    src: string | undefined,
    private readonly owner: FakeAudioRegistry,
  ) {
    super()
    if (src !== undefined) this.src = src
  }

  get src(): string {
    return this.srcValue
  }

  set src(value: string) {
    // A real media load resets playback state and the rate to `defaultPlaybackRate`.
    this.clearTimers()
    this.srcValue = value
    this.srcHistory.push(value)
    this.paused = true
    this.currentTime = 0
    this.playbackRate = this.defaultPlaybackRate
  }

  play(): Promise<void> {
    this.playCalls++
    const rejection = this.owner.takeRejection()
    if (rejection) return Promise.reject(new DOMException('play() refused', rejection))

    this.paused = false
    this.clearTimers()
    this.later(() => this.fire('playing'), 0)
    this.later(() => {
      this.paused = true
      this.fire('ended')
    }, this.owner.clipMs)
    return Promise.resolve()
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.clearTimers()
    this.fire('pause')
  }

  load(): void {}

  /** Test hook: fire `error` and stop. */
  fail(): void {
    this.clearTimers()
    this.paused = true
    this.fire('error')
  }

  dispose(): void {
    this.clearTimers()
  }

  private fire(type: 'playing' | 'ended' | 'error' | 'pause'): void {
    const event = new Event(type)
    const handler = this[`on${type}`]
    handler?.call(this, event)
    this.dispatchEvent(event)
  }

  private later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timers.delete(id)
      fn()
    }, ms)
    this.timers.add(id)
  }

  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id)
    this.timers.clear()
  }
}

class FakeAudioRegistry {
  readonly created: FakeAudioElement[] = []
  private pendingRejection: string | null = null

  constructor(readonly clipMs: number) {}

  takeRejection(): string | null {
    const name = this.pendingRejection
    this.pendingRejection = null
    return name
  }

  control(): FakeAudioControl {
    return {
      instances: () => [...this.created],
      rejectNextPlay: (name: string) => {
        this.pendingRejection = name
      },
      failCurrent: (element: FakeAudioElement) => element.fail(),
    }
  }

  dispose(): void {
    for (const element of this.created) element.dispose()
  }
}

let installed: FakeAudioRegistry | null = null
let originalAudio: PropertyDescriptor | undefined

/** Replaces `window.Audio` with the fake. Returns the control surface. */
export function installFakeAudio(opts: FakeAudioOptions = {}): FakeAudioControl {
  uninstallFakeAudio()

  const registry = new FakeAudioRegistry(opts.clipMs ?? 100)
  installed = registry
  originalAudio = Object.getOwnPropertyDescriptor(window, 'Audio')

  function Audio(src?: string): FakeAudioElement {
    const element = new FakeAudioElement(src, registry)
    registry.created.push(element)
    return element
  }

  Object.defineProperty(window, 'Audio', { value: Audio, configurable: true, writable: true })
  return registry.control()
}

/** Restores jsdom's own `Audio` (not a delete — jsdom ships one). */
export function uninstallFakeAudio(): void {
  if (!installed) return
  installed.dispose()
  installed = null
  if (originalAudio) Object.defineProperty(window, 'Audio', originalAudio)
  else Reflect.deleteProperty(window, 'Audio')
  originalAudio = undefined
}
