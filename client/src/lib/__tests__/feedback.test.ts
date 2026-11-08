import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildFeedbackContext, submitFeedback } from '../feedback'
import type { FeedbackCreateRequest } from '../../types'

const baseInput = {
  pathname: '/cart',
  search: '',
  dark: false,
  sessionId: 'sess-1',
  viewport: { width: 393, height: 852 },
  build: undefined as string | undefined,
  recentErrors: [] as string[],
}

describe('buildFeedbackContext', () => {
  it('extracts book_id from /book/:id', () => {
    expect(buildFeedbackContext({ ...baseInput, pathname: '/book/xyz' }).book_id).toBe('xyz')
  })

  it('returns a null book_id off a book route', () => {
    expect(buildFeedbackContext(baseInput).book_id).toBeNull()
  })

  it('sets route to pathname + search', () => {
    const ctx = buildFeedbackContext({ ...baseInput, pathname: '/book/abc', search: '?theater=1' })
    expect(ctx.route).toBe('/book/abc?theater=1')
    expect(ctx.book_id).toBe('abc')
  })

  it('maps theme from dark', () => {
    expect(buildFeedbackContext({ ...baseInput, dark: true }).theme).toBe('dark')
    expect(buildFeedbackContext(baseInput).theme).toBe('light')
  })

  it('sends client_build null when the build id is undefined', () => {
    expect(buildFeedbackContext(baseInput).client_build).toBeNull()
    expect(buildFeedbackContext({ ...baseInput, build: 'abc1234' }).client_build).toBe('abc1234')
  })

  it('carries session id, viewport, and recent errors', () => {
    expect(buildFeedbackContext({ ...baseInput, recentErrors: ['boom'] })).toEqual({
      route: '/cart',
      book_id: null,
      session_id: 'sess-1',
      viewport_width: 393,
      viewport_height: 852,
      theme: 'light',
      client_build: null,
      recent_errors: ['boom'],
    })
  })
})

const body: FeedbackCreateRequest = {
  category: 'bug',
  message: 'hello',
  route: '/',
  book_id: null,
  session_id: 'sess-1',
  viewport_width: 1,
  viewport_height: 1,
  theme: 'light',
  client_build: null,
  recent_errors: [],
}

function stubResponse(status: number, json: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('submitFeedback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ok with the data on 201 and sends a bearer token', async () => {
    const data = { id: 'f-1', status: 'new', created_at: '2026-11-08T00:00:00.000Z' }
    const fetchMock = stubResponse(201, data)
    const result = await submitFeedback('tok', body)
    expect(result).toEqual({ ok: true, data })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/feedback$/)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual(body)
  })

  it('maps 401 to auth', async () => {
    stubResponse(401, { error: 'Unauthorized' })
    expect(await submitFeedback('tok', body)).toMatchObject({ ok: false, kind: 'auth' })
  })

  it('maps 429 to rate with the server message', async () => {
    stubResponse(429, { error: "You've sent a lot of feedback in a few minutes. Try again shortly.", retryAfterSeconds: 30 })
    expect(await submitFeedback('tok', body)).toEqual({
      ok: false,
      kind: 'rate',
      message: "You've sent a lot of feedback in a few minutes. Try again shortly.",
    })
  })

  it('maps 400 to invalid', async () => {
    stubResponse(400, { error: 'Invalid request body' })
    expect(await submitFeedback('tok', body)).toMatchObject({ ok: false, kind: 'invalid' })
  })

  it('maps a rejected fetch to network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await submitFeedback('tok', body)).toMatchObject({ ok: false, kind: 'network' })
  })

  it('maps a 500 to network', async () => {
    stubResponse(500, { error: 'boom' })
    expect(await submitFeedback('tok', body)).toMatchObject({ ok: false, kind: 'network' })
  })
})
