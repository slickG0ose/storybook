import { describe, it, expect } from 'vitest'
import { describeFailure, readErrorMessage, UNREACHABLE_MESSAGE } from '../friendlyError'

describe('readErrorMessage', () => {
  it("returns the server's error text when the body carries one", async () => {
    const res = new Response(JSON.stringify({ error: 'Daily limit reached' }), { status: 429 })
    expect(await readErrorMessage(res, 'Generation failed')).toBe('Daily limit reached')
  })

  it('falls back when the body is not JSON, instead of throwing', async () => {
    const res = new Response('<html>nope</html>', { status: 500 })
    expect(await readErrorMessage(res, 'Generation failed')).toBe('Generation failed')
  })

  it('explains a gateway error (the host answering while the API starts)', async () => {
    const res = new Response('<html>Bad Gateway</html>', { status: 502 })
    expect(await readErrorMessage(res, 'Generation failed')).toBe(UNREACHABLE_MESSAGE)
  })

  it('keeps a JSON 503 message, such as the monthly ceiling', async () => {
    const res = new Response(JSON.stringify({ error: 'Monthly budget reached' }), { status: 503 })
    expect(await readErrorMessage(res, 'x')).toBe('Monthly budget reached')
  })
})

describe('describeFailure', () => {
  it("never shows the browser's network wording", () => {
    expect(describeFailure(new TypeError('Failed to fetch'), 'x')).toBe(UNREACHABLE_MESSAGE)
    expect(describeFailure(new SyntaxError("Unexpected token '<'"), 'x')).toBe(UNREACHABLE_MESSAGE)
  })

  it('passes through a message we raised ourselves, and falls back otherwise', () => {
    expect(describeFailure(new Error('Daily limit reached'), 'x')).toBe('Daily limit reached')
    expect(describeFailure('boom', 'Generation failed')).toBe('Generation failed')
  })
})
