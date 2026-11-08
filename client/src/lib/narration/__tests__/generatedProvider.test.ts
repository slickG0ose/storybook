import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { splitIntoUtterances, type NarrationReady } from '@storybook/shared'
import { createGeneratedProvider, SILENT_WAV } from '../generatedProvider'
import { deviceProvider } from '../deviceProvider'
import type {
  NarrationErrorReason,
  NarrationEvents,
  NarrationProvider,
  NarrationSpeakOptions,
} from '../provider'
import {
  installFakeAudio,
  uninstallFakeAudio,
  type FakeAudioControl,
  type FakeAudioElement,
} from '../../../test/fakeAudio'

/**
 * The generated provider against `fakeAudio` + a stubbed `fetch`. No network, no real
 * media element: these prove the wiring (prime → GET → POST → clip sequence → events),
 * not that a browser will actually play a WAV — that is the manual desktop + iPhone listen.
 */

const PAGE_TEXT = 'Luna woke up. The garden was glowing. She ran outside.'
const CHUNKS = splitIntoUtterances(PAGE_TEXT)
const BOOK_ID = 'book-1'
const TARGET = { bookId: BOOK_ID, slot: 1 } as const
const OPTS: NarrationSpeakOptions = {
  voiceURI: 'generated:af_heart',
  rate: 1,
  fromChunk: 0,
  target: TARGET,
}

function readyFor(chunks = CHUNKS, overrides: Partial<NarrationReady> = {}): NarrationReady {
  return {
    status: 'ready',
    voiceId: 'af_heart',
    slot: 1,
    textHash: 'abc123',
    cached: true,
    segments: chunks.map((chunk, index) => ({
      index,
      start: chunk.start,
      end: chunk.end,
      url: `/illustrations/${BOOK_ID}/narration/p1-af_heart-abc-${index}.wav`,
      durationMs: 1000,
    })),
    ...overrides,
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

/** A routing fetch stub: `get` answers the GET, `post` answers the POST. */
function stubFetch(handlers: {
  get?: () => Promise<Response> | Response
  post?: () => Promise<Response> | Response
}) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({
      method,
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const handler = method === 'POST' ? handlers.post : handlers.get
    if (!handler) throw new Error(`unexpected ${method} ${String(input)}`)
    return handler()
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

function recorder() {
  const log: string[] = []
  const onError = vi.fn((reason: NarrationErrorReason) => void log.push(`error:${reason}`))
  const onPreparing = vi.fn(() => void log.push('preparing'))
  const onWordBoundary = vi.fn(() => void log.push('word'))
  const events: NarrationEvents = {
    onChunkStart: (i) => void log.push(`start:${i}`),
    onWordBoundary,
    onChunkEnd: (i) => void log.push(`end:${i}`),
    onDone: () => void log.push('done'),
    onError,
    onPreparing,
  }
  return { events, log, onError, onPreparing, onWordBoundary }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('createGeneratedProvider', () => {
  let audio: FakeAudioControl
  let token: string | null

  const make = (fetchImpl: typeof fetch): NarrationProvider =>
    createGeneratedProvider({ getToken: () => token, fetchImpl })
  /** The single playback element (the first one created). */
  const player = (): FakeAudioElement => {
    const el = audio.instances()[0]
    if (!el) throw new Error('no audio element created')
    return el
  }
  /** Flush microtasks (fetch + JSON) and any 0 ms timers. */
  const flush = () => vi.advanceTimersByTimeAsync(0)

  beforeEach(() => {
    vi.useFakeTimers()
    audio = installFakeAudio({ clipMs: 100 })
    token = 'tok-123'
  })

  afterEach(() => {
    uninstallFakeAudio()
    vi.useRealTimers()
  })

  it('reports itself as a generated provider that needs no start watchdog', () => {
    const provider = make(stubFetch({}).fetchImpl)
    expect(provider.id).toBe('generated')
    expect(provider.needsStartWatchdog).toBe(false)
    expect(deviceProvider.needsStartWatchdog).toBe(true)
    expect(provider.isAvailable()).toBe(true)
    expect(provider.listVoices().map((v) => v.uri)).toEqual([
      'generated:af_heart',
      'generated:am_michael',
    ])
  })

  it('primes the element synchronously inside speak(), before the first fetch resolves', async () => {
    const get = deferred<Response>()
    const { fetchImpl } = stubFetch({ get: () => get.promise })
    const { events, onPreparing } = recorder()

    make(fetchImpl).speak(CHUNKS, OPTS, events)

    // Nothing awaited yet: the gesture-bound call has already happened.
    expect(player().srcHistory).toEqual([SILENT_WAV])
    expect(player().playCalls).toBe(1)
    expect(onPreparing).toHaveBeenCalledTimes(1)

    get.resolve(json(readyFor()))
    await flush()
    expect(player().src).toBe(readyFor().segments[0]!.url)
  })

  it('plays a cached slot from the GET alone — no POST', async () => {
    const { fetchImpl, calls } = stubFetch({ get: () => json(readyFor()) })
    const { events } = recorder()

    make(fetchImpl).speak(CHUNKS, OPTS, events)
    await flush()

    expect(calls.map((c) => c.method)).toEqual(['GET'])
    expect(calls[0]!.url).toBe(`/api/books/${BOOK_ID}/narration?voice=af_heart&slot=1`)
  })

  it('on a miss with a token, POSTs { voiceId, slot } with the bearer header and never a text field', async () => {
    const { fetchImpl, calls } = stubFetch({
      get: () => json({ status: 'missing' }),
      post: () => json(readyFor(CHUNKS, { cached: false })),
    })
    const { events, log } = recorder()

    make(fetchImpl).speak(CHUNKS, { ...OPTS, rate: 1.25 }, events)
    await flush()

    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe(`/api/books/${BOOK_ID}/narration`)
    expect(post.headers.Authorization).toBe('Bearer tok-123')
    // Exactly these two keys: no text (open TTS proxy) and no rate (not part of the cache key).
    expect(post.body).toEqual({ voiceId: 'af_heart', slot: 1 })
    expect(calls.every((c) => !c.url.includes('rate'))).toBe(true)
    expect(log).toContain('start:0')
  })

  it('on a miss without a token, reports generation-unavailable and never POSTs', async () => {
    token = null
    const { fetchImpl, calls } = stubFetch({ get: () => json({ status: 'missing' }) })
    const { events, log } = recorder()

    make(fetchImpl).speak(CHUNKS, OPTS, events)
    await flush()

    expect(calls.map((c) => c.method)).toEqual(['GET'])
    expect(log).toEqual(['preparing', 'error:generation-unavailable'])
  })

  it('fires start/end per clip in order, then onDone — and never a word boundary', async () => {
    const { fetchImpl } = stubFetch({ get: () => json(readyFor()) })
    const { events, log, onWordBoundary } = recorder()

    make(fetchImpl).speak(CHUNKS, OPTS, events)
    await vi.advanceTimersByTimeAsync(1000)

    expect(CHUNKS).toHaveLength(3)
    expect(log).toEqual(['preparing', 'start:0', 'end:0', 'start:1', 'end:1', 'start:2', 'end:2', 'done'])
    expect(onWordBoundary).not.toHaveBeenCalled()
    const urls = readyFor().segments.map((s) => s.url)
    expect(player().srcHistory).toEqual([SILENT_WAV, ...urls])
  })

  it('preloads the next clip on a separate element while the current one plays', async () => {
    const { fetchImpl } = stubFetch({ get: () => json(readyFor()) })
    make(fetchImpl).speak(CHUNKS, OPTS, recorder().events)
    await flush()

    const preloader = audio.instances()[1]!
    expect(preloader.src).toBe(readyFor().segments[1]!.url)
    expect(preloader.playCalls).toBe(0)
  })

  it('fromChunk: 2 starts at clip 2 and keeps indices absolute', async () => {
    const { fetchImpl } = stubFetch({ get: () => json(readyFor()) })
    const { events, log } = recorder()

    make(fetchImpl).speak(CHUNKS, { ...OPTS, fromChunk: 2 }, events)
    await vi.advanceTimersByTimeAsync(1000)

    expect(log).toEqual(['preparing', 'start:2', 'end:2', 'done'])
  })

  it.each([
    [501, 'generation-unavailable'],
    [401, 'generation-unavailable'],
    [429, 'quota'],
    [503, 'quota'],
    [502, 'synthesis-failed'],
    [409, 'synthesis-failed'],
  ] as const)('maps a POST %i to %s', async (status, reason) => {
    const { fetchImpl } = stubFetch({
      get: () => json({ status: 'missing' }),
      post: () => json({ error: 'nope' }, status),
    })
    const { events, log } = recorder()

    make(fetchImpl).speak(CHUNKS, OPTS, events)
    await flush()

    expect(log).toEqual(['preparing', `error:${reason}`])
  })

  it('quota is sticky: the next speak short-circuits without touching the network', async () => {
    const { fetchImpl, calls } = stubFetch({
      get: () => json({ status: 'missing' }),
      post: () => json({ error: 'Daily limit reached' }, 429),
    })
    const provider = make(fetchImpl)
    provider.speak(CHUNKS, OPTS, recorder().events)
    await flush()
    const before = calls.length

    const second = recorder()
    provider.speak(CHUNKS, { ...OPTS, target: { bookId: BOOK_ID, slot: 2 } }, second.events)
    await flush()

    expect(calls).toHaveLength(before)
    expect(second.log).toEqual(['error:quota'])
  })

  it('maps a network failure, a malformed body, and a clip load error to synthesis-failed', async () => {
    const network = recorder()
    make(stubFetch({ get: () => Promise.reject(new TypeError('offline')) }).fetchImpl).speak(
      CHUNKS,
      OPTS,
      network.events,
    )
    await flush()
    expect(network.log).toEqual(['preparing', 'error:synthesis-failed'])

    const malformed = recorder()
    make(stubFetch({ get: () => json({ status: 'ready', segments: [] }) }).fetchImpl).speak(
      CHUNKS,
      OPTS,
      malformed.events,
    )
    await flush()
    expect(malformed.log).toEqual(['preparing', 'error:synthesis-failed'])

    const clip = recorder()
    make(stubFetch({ get: () => json(readyFor()) }).fetchImpl).speak(CHUNKS, OPTS, clip.events)
    await flush()
    audio.failCurrent(audio.instances().at(-2)!)
    await flush()
    expect(clip.log).toEqual(['preparing', 'start:0', 'error:synthesis-failed'])
  })

  it('reports synthesis-failed when the server offsets do not match the client chunks', async () => {
    const shifted = readyFor()
    shifted.segments[1] = { ...shifted.segments[1]!, start: shifted.segments[1]!.start + 1 }
    const { fetchImpl } = stubFetch({ get: () => json(shifted) })
    const { events, log } = recorder()

    make(fetchImpl).speak(CHUNKS, OPTS, events)
    await flush()

    expect(log).toEqual(['preparing', 'error:synthesis-failed'])
    expect(player().srcHistory).toEqual([SILENT_WAV])
  })

  it('maps a NotAllowedError from play() to not-allowed', async () => {
    const { fetchImpl } = stubFetch({ get: () => json(readyFor()) })
    const { events, log } = recorder()

    make(fetchImpl).speak(CHUNKS, OPTS, events)
    // The prime has already consumed its play(); refuse the clip's.
    audio.rejectNextPlay('NotAllowedError')
    await vi.advanceTimersByTimeAsync(1000)

    expect(log).toEqual(['preparing', 'error:not-allowed'])
  })

  it('is silent after cancel() mid-fetch', async () => {
    const get = deferred<Response>()
    const { fetchImpl } = stubFetch({ get: () => get.promise })
    const { events, log } = recorder()

    const handle = make(fetchImpl).speak(CHUNKS, OPTS, events)
    handle.cancel()
    get.resolve(json(readyFor()))
    await vi.advanceTimersByTimeAsync(1000)

    expect(log).toEqual(['preparing'])
    expect(player().srcHistory).toEqual([SILENT_WAV])
  })

  it('is silent after cancel() mid-clip, and stops the element', async () => {
    const { fetchImpl } = stubFetch({ get: () => json(readyFor()) })
    const { events, log } = recorder()

    const handle = make(fetchImpl).speak(CHUNKS, OPTS, events)
    await flush()
    expect(log).toEqual(['preparing', 'start:0'])

    handle.cancel()
    await vi.advanceTimersByTimeAsync(1000)

    expect(log).toEqual(['preparing', 'start:0'])
    expect(player().paused).toBe(true)
  })

  it('a superseded handle cannot drive the shared element', async () => {
    const slow = deferred<Response>()
    let first = true
    const { fetchImpl } = stubFetch({
      get: () => {
        if (first) {
          first = false
          return slow.promise
        }
        return json(readyFor(CHUNKS, { slot: 2 }))
      },
    })
    const provider = make(fetchImpl)
    const stale = recorder()
    const fresh = recorder()

    provider.speak(CHUNKS, OPTS, stale.events)
    provider.speak(CHUNKS, { ...OPTS, target: { bookId: BOOK_ID, slot: 2 } }, fresh.events)
    await flush()
    slow.resolve(json(readyFor()))
    await vi.advanceTimersByTimeAsync(1000)

    expect(stale.log).toEqual(['preparing'])
    expect(fresh.log.at(-1)).toBe('done')
  })

  it('pause() holds the clip and resume() continues it', async () => {
    const { fetchImpl } = stubFetch({ get: () => json(readyFor()) })
    const { events, log } = recorder()

    const handle = make(fetchImpl).speak(CHUNKS, OPTS, events)
    await flush()
    handle.pause()
    await vi.advanceTimersByTimeAsync(1000)
    expect(log).toEqual(['preparing', 'start:0'])

    handle.resume()
    await vi.advanceTimersByTimeAsync(1000)
    // `playing` fires again on resume; the chunk start is reported once.
    expect(log).toEqual(['preparing', 'start:0', 'end:0', 'start:1', 'end:1', 'start:2', 'end:2', 'done'])
  })

  it('applies the rate via playbackRate, survives source changes, and setRate() applies live', async () => {
    const { fetchImpl } = stubFetch({ get: () => json(readyFor()) })
    const handle = make(fetchImpl).speak(CHUNKS, { ...OPTS, rate: 1.25 }, recorder().events)
    await flush()
    expect(player().playbackRate).toBe(1.25)

    handle.setRate?.(0.75)
    expect(player().playbackRate).toBe(0.75)

    await vi.advanceTimersByTimeAsync(100) // clip 0 ends, clip 1 loads
    expect(player().src).toBe(readyFor().segments[1]!.url)
    expect(player().playbackRate).toBe(0.75)
  })

  it('reports generation-unavailable for a device voice URI or a missing target', async () => {
    const { fetchImpl, calls } = stubFetch({})
    const device = recorder()
    const provider = make(fetchImpl)

    provider.speak(CHUNKS, { ...OPTS, voiceURI: 'urn:voice:samantha' }, device.events)
    await flush()
    const noTarget = recorder()
    provider.speak(CHUNKS, { ...OPTS, target: undefined }, noTarget.events)
    await flush()

    expect(device.log).toEqual(['error:generation-unavailable'])
    expect(noTarget.log).toEqual(['error:generation-unavailable'])
    expect(calls).toHaveLength(0)
  })

  describe('prefetch', () => {
    it('GETs, then POSTs on a miss with a token, and a later speak plays from the cache', async () => {
      const { fetchImpl, calls } = stubFetch({
        get: () => json({ status: 'missing' }),
        post: () => json(readyFor(CHUNKS, { cached: false })),
      })
      const provider = make(fetchImpl)

      provider.prefetch?.(TARGET, 'generated:af_heart')
      await flush()
      expect(calls.map((c) => c.method)).toEqual(['GET', 'POST'])

      const { events, log, onPreparing } = recorder()
      provider.speak(CHUNKS, OPTS, events)
      await flush()

      expect(calls).toHaveLength(2)
      expect(onPreparing).not.toHaveBeenCalled()
      expect(log).toEqual(['start:0'])
    })

    it('shares one in-flight load with a speak for the same slot', async () => {
      const post = deferred<Response>()
      const { fetchImpl, calls } = stubFetch({
        get: () => json({ status: 'missing' }),
        post: () => post.promise,
      })
      const provider = make(fetchImpl)

      provider.prefetch?.(TARGET, 'generated:af_heart')
      await flush()
      const { events, log } = recorder()
      provider.speak(CHUNKS, OPTS, events)
      post.resolve(json(readyFor()))
      await flush()

      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
      expect(log).toEqual(['preparing', 'start:0'])
    })

    it('does not POST without a token', async () => {
      token = null
      const { fetchImpl, calls } = stubFetch({ get: () => json({ status: 'missing' }) })
      make(fetchImpl).prefetch?.(TARGET, 'generated:af_heart')
      await flush()
      expect(calls.map((c) => c.method)).toEqual(['GET'])
    })

    it('a quota-denied prefetch blocks the session', async () => {
      const { fetchImpl, calls } = stubFetch({
        get: () => json({ status: 'missing' }),
        post: () => json({ error: 'Monthly limit reached' }, 503),
      })
      const provider = make(fetchImpl)
      provider.prefetch?.(TARGET, 'generated:af_heart')
      await flush()
      const before = calls.length

      const { events, log } = recorder()
      provider.speak(CHUNKS, OPTS, events)
      provider.prefetch?.({ bookId: BOOK_ID, slot: 2 }, 'generated:af_heart')
      await flush()

      expect(log).toEqual(['error:quota'])
      expect(calls).toHaveLength(before)
    })
  })
})
