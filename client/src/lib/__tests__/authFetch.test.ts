import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authFetch, AUTH_EXPIRED_EVENT } from '../authFetch'

const fetchMock = vi.fn()
let events: CustomEvent[] = []
const listener = (e: Event) => events.push(e as CustomEvent)

beforeEach(() => {
  events = []
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.addEventListener(AUTH_EXPIRED_EVENT, listener)
})
afterEach(() => {
  window.removeEventListener(AUTH_EXPIRED_EVENT, listener)
  vi.unstubAllGlobals()
})

describe('authFetch', () => {
  it('sets the bearer header and keeps caller headers', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await authFetch('tok', '/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const h = new Headers(init.headers)
    expect(url).toBe('/api/x')
    expect(init.method).toBe('POST')
    expect(h.get('Authorization')).toBe('Bearer tok')
    expect(h.get('Content-Type')).toBe('application/json')
  })

  it('sends no header without a token, and never dispatches on 401', async () => {
    const res = new Response('{}', { status: 401 })
    fetchMock.mockResolvedValue(res)
    for (const t of [null, undefined, '']) {
      expect(await authFetch(t, '/api/x')).toBe(res)
    }
    for (const call of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      expect(new Headers(call[1]?.headers).has('Authorization')).toBe(false)
    }
    expect(events).toHaveLength(0)
  })

  it('dispatches once on 401 with the token and returns the same Response', async () => {
    const res = new Response('{}', { status: 401 })
    fetchMock.mockResolvedValue(res)
    expect(await authFetch('tok', '/api/x')).toBe(res)
    expect(events).toHaveLength(1)
    expect(events[0]?.detail).toEqual({ token: 'tok' })
  })

  it.each([200, 403, 404, 500])('does not dispatch on %i', async status => {
    fetchMock.mockResolvedValue(new Response('{}', { status }))
    await authFetch('tok', '/api/x')
    expect(events).toHaveLength(0)
  })

  it('rejects when fetch rejects, without dispatching', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    await expect(authFetch('tok', '/api/x')).rejects.toThrow('offline')
    expect(events).toHaveLength(0)
  })
})
