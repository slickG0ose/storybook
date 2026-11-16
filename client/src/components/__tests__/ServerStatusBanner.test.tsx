import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ServerStatusBanner from '../ServerStatusBanner'
import { GIVE_UP_AFTER_MS, RETRY_EVERY_MS, SERVER_READY_EVENT, SLOW_AFTER_MS } from '../../lib/serverStatus'

const fetchMock = vi.fn()
const ok = () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setOnline(true)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setOnline(true)
})

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('ServerStatusBanner', () => {
  it('renders nothing when the health check answers promptly', async () => {
    fetchMock.mockResolvedValue(ok())
    render(<ServerStatusBanner />)
    await advance(SLOW_AFTER_MS + 1000)
    expect(screen.queryByRole('status')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything())
  })

  it('explains the wait when the server is slow to answer, then clears and announces ready', async () => {
    let release: (r: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>(resolve => { release = resolve }))
    const ready = vi.fn()
    window.addEventListener(SERVER_READY_EVENT, ready)

    render(<ServerStatusBanner />)
    await advance(SLOW_AFTER_MS - 100)
    expect(screen.queryByRole('status')).toBeNull()

    await advance(200)
    expect(screen.getByRole('status')).toHaveTextContent('Waking up the story server')

    release(ok())
    await advance(0)
    expect(screen.queryByRole('status')).toBeNull()
    expect(ready).toHaveBeenCalledTimes(1)
    window.removeEventListener(SERVER_READY_EVENT, ready)
  })

  it('retries after a gateway error and recovers', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 })).mockResolvedValue(ok())
    render(<ServerStatusBanner />)
    await advance(0)
    expect(screen.getByRole('status')).toHaveTextContent('Waking up the story server')

    await advance(RETRY_EVERY_MS)
    expect(screen.queryByRole('status')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after the limit, says so, and Try again starts over', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ServerStatusBanner />)
    await advance(GIVE_UP_AFTER_MS + RETRY_EVERY_MS)
    expect(screen.getByRole('status')).toHaveTextContent("We can't reach the story server right now.")
    const callsAtGiveUp = fetchMock.mock.calls.length

    await advance(RETRY_EVERY_MS * 3)
    expect(fetchMock.mock.calls.length).toBe(callsAtGiveUp)

    fetchMock.mockResolvedValue(ok())
    await act(async () => { screen.getByRole('button', { name: 'Try again' }).click() })
    await advance(0)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says offline without polling, and re-checks when the connection returns', async () => {
    setOnline(false)
    render(<ServerStatusBanner />)
    await advance(SLOW_AFTER_MS * 2)
    expect(screen.getByRole('status')).toHaveTextContent("You're offline")
    expect(fetchMock).not.toHaveBeenCalled()

    setOnline(true)
    fetchMock.mockResolvedValue(ok())
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await advance(0)
    expect(screen.queryByRole('status')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
