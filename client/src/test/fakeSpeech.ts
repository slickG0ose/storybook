/**
 * An installable fake `window.speechSynthesis` for jsdom.
 *
 * **Install it explicitly, per test file — never globally in `setup.ts`.** jsdom has no
 * `speechSynthesis`, and that absence is exactly what the narration `'unavailable'` path
 * needs in order to be testable. A global install would make the most important degraded
 * state in the feature unreachable.
 *
 * The fake is deliberately dumb: a FIFO queue advanced by timers, no clever behaviour. It
 * is *our model* of the Web Speech API, not the API — every assertion written against it
 * inherits its assumptions. `deviceProvider.test.ts` is where that model is pinned (the
 * event field names, the error codes, the cancel semantics) so drift shows up in one file
 * rather than diffusely. Audibility is not testable here at all; that is the one manual
 * listen recorded in the spec's autonomy ledger.
 *
 * Use with `vi.useFakeTimers()` — every transition is timer-driven and therefore
 * deterministic.
 */

export interface FakeVoiceSpec {
  voiceURI: string
  name: string
  lang: string
  localService: boolean
  default?: boolean
}

export interface FakeSpeechOptions {
  voices?: FakeVoiceSpec[]
  /** Emit word-granularity `boundary` events. Default false — matches Safari/Android. */
  emitWordBoundary?: boolean
  /** Simulated ms per utterance under fake timers. Default 100. */
  chunkMs?: number
  /** Populate `getVoices()` only after this many ms, mimicking Chrome's empty first call. */
  voicesReadyAfterMs?: number
}

export interface FakeSpeechControl {
  /** Every utterance text passed to `speak()`, in order — the queue assertion surface. */
  spoken(): string[]
  /** The utterance objects themselves, for assertions on `voice` / `rate`. */
  utterances(): SpeechSynthesisUtterance[]
  cancelCount(): number
  /** Force an error on the currently-speaking utterance. */
  failCurrent(error: string): void
}

const DEFAULT_VOICES: FakeVoiceSpec[] = [
  { voiceURI: 'urn:voice:samantha', name: 'Samantha', lang: 'en-US', localService: true, default: true },
  { voiceURI: 'urn:voice:daniel', name: 'Daniel', lang: 'en-GB', localService: false },
]

/** Minimal `SpeechSynthesisEvent` stand-in — jsdom has no constructor for it. */
function speechEvent(
  utterance: FakeUtterance,
  fields: { name?: string; charIndex?: number; charLength?: number; error?: string },
): SpeechSynthesisEvent {
  return {
    utterance,
    charIndex: 0,
    charLength: 0,
    elapsedTime: 0,
    name: '',
    ...fields,
  } as unknown as SpeechSynthesisEvent
}

class FakeUtterance extends EventTarget {
  text: string
  lang = ''
  voice: SpeechSynthesisVoice | null = null
  rate = 1
  pitch = 1
  volume = 1
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null
  onend: ((event: SpeechSynthesisEvent) => void) | null = null
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null
  onboundary: ((event: SpeechSynthesisEvent) => void) | null = null
  onpause: ((event: SpeechSynthesisEvent) => void) | null = null
  onresume: ((event: SpeechSynthesisEvent) => void) | null = null
  onmark: ((event: SpeechSynthesisEvent) => void) | null = null

  constructor(text = '') {
    super()
    this.text = text
  }
}

class FakeSpeechSynthesis extends EventTarget {
  paused = false
  pending = false
  speaking = false
  onvoiceschanged: ((event: Event) => void) | null = null

  private readonly opts: Required<Omit<FakeSpeechOptions, 'voicesReadyAfterMs'>> & {
    voicesReadyAfterMs: number | null
  }
  private readonly queue: FakeUtterance[] = []
  private readonly allUtterances: FakeUtterance[] = []
  private readonly spokenTexts: string[] = []
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private current: FakeUtterance | null = null
  private cancels = 0
  private voicesReady: boolean

  constructor(options: FakeSpeechOptions) {
    super()
    this.opts = {
      voices: options.voices ?? DEFAULT_VOICES,
      emitWordBoundary: options.emitWordBoundary ?? false,
      chunkMs: options.chunkMs ?? 100,
      voicesReadyAfterMs: options.voicesReadyAfterMs ?? null,
    }
    this.voicesReady = this.opts.voicesReadyAfterMs === null

    if (!this.voicesReady) {
      this.later(() => {
        this.voicesReady = true
        const event = new Event('voiceschanged')
        this.onvoiceschanged?.(event)
        this.dispatchEvent(event)
      }, this.opts.voicesReadyAfterMs ?? 0)
    }
  }

  // --- SpeechSynthesis surface -------------------------------------------------

  getVoices(): SpeechSynthesisVoice[] {
    if (!this.voicesReady) return []
    return this.opts.voices.map(
      (spec) =>
        ({
          voiceURI: spec.voiceURI,
          name: spec.name,
          lang: spec.lang,
          localService: spec.localService,
          default: spec.default ?? false,
        }) as SpeechSynthesisVoice,
    )
  }

  speak(utterance: FakeUtterance): void {
    this.queue.push(utterance)
    this.allUtterances.push(utterance)
    this.spokenTexts.push(utterance.text)
    this.pump()
    this.pending = this.queue.length > 0
  }

  cancel(): void {
    this.cancels++
    const interrupted = this.current
    this.clearTimers()
    this.queue.length = 0
    this.current = null
    this.speaking = false
    this.pending = false
    this.paused = false

    // Chrome still fires `end` on the in-flight utterance, asynchronously, after the
    // caller has moved on. Modelling that is the whole point of this fake existing.
    if (interrupted) {
      setTimeout(() => interrupted.onend?.(speechEvent(interrupted, {})), 0)
    }
  }

  pause(): void {
    if (!this.speaking) return
    this.paused = true
    this.clearTimers()
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    const speaking = this.current
    if (speaking) this.later(() => this.finish(speaking), this.opts.chunkMs)
  }

  // --- internals ---------------------------------------------------------------

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

  private pump(): void {
    if (this.current || this.queue.length === 0) return
    const next = this.queue.shift()
    if (!next) return
    this.current = next
    this.later(() => this.start(next), 0)
  }

  private start(utterance: FakeUtterance): void {
    this.speaking = true
    this.pending = this.queue.length > 0
    utterance.onstart?.(speechEvent(utterance, {}))

    if (this.opts.emitWordBoundary) {
      for (const word of wordOffsets(utterance.text)) {
        const at = Math.round(
          (word.index / Math.max(1, utterance.text.length)) * this.opts.chunkMs,
        )
        this.later(
          () =>
            utterance.onboundary?.(
              speechEvent(utterance, {
                name: 'word',
                charIndex: word.index,
                charLength: word.length,
              }),
            ),
          at,
        )
      }
    }

    this.later(() => this.finish(utterance), this.opts.chunkMs)
  }

  private finish(utterance: FakeUtterance): void {
    if (this.current !== utterance) return
    this.current = null
    this.speaking = false
    utterance.onend?.(speechEvent(utterance, {}))
    this.pump()
  }

  // --- control surface ----------------------------------------------------------

  control(): FakeSpeechControl {
    return {
      spoken: () => [...this.spokenTexts],
      utterances: () => [...this.allUtterances] as unknown as SpeechSynthesisUtterance[],
      cancelCount: () => this.cancels,
      failCurrent: (error: string) => {
        const failing = this.current
        if (!failing) throw new Error('failCurrent(): nothing is speaking')
        this.clearTimers()
        this.queue.length = 0
        this.current = null
        this.speaking = false
        failing.onerror?.(speechEvent(failing, { error }) as SpeechSynthesisErrorEvent)
      },
    }
  }

  dispose(): void {
    this.clearTimers()
  }
}

/** Word start offsets and lengths within `text`, for simulated `boundary` events. */
function wordOffsets(text: string): { index: number; length: number }[] {
  const words: { index: number; length: number }[] = []
  const pattern = /\S+/g
  let match = pattern.exec(text)
  while (match !== null) {
    words.push({ index: match.index, length: match[0].length })
    match = pattern.exec(text)
  }
  return words
}

let installed: FakeSpeechSynthesis | null = null

export function installFakeSpeech(opts: FakeSpeechOptions = {}): FakeSpeechControl {
  uninstallFakeSpeech()

  const fake = new FakeSpeechSynthesis(opts)
  installed = fake

  Object.defineProperty(window, 'speechSynthesis', {
    value: fake,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: FakeUtterance,
    configurable: true,
    writable: true,
  })

  return fake.control()
}

export function uninstallFakeSpeech(): void {
  installed?.dispose()
  installed = null
  Reflect.deleteProperty(window, 'speechSynthesis')
  Reflect.deleteProperty(window, 'SpeechSynthesisUtterance')
}
