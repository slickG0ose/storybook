import { describe, it, expect } from 'vitest'
import {
  mediaPath,
  mediaExpiresAt,
  MEDIA_EXPIRES_PARAM,
  MEDIA_SIG_PARAM,
  MEDIA_ROOTS,
  MEDIA_PATH_RE,
} from '@storybook/shared'

// shared/ has no test runner of its own; its helpers are tested from the client.
describe('mediaPath', () => {
  it('returns an unsigned path unchanged', () => {
    expect(mediaPath('/illustrations/b1/page-1-v1.png')).toBe('/illustrations/b1/page-1-v1.png')
  })
  it('strips a signed query and a hash', () => {
    expect(mediaPath('/illustrations/b1/p.png?e=1700000000&s=abc')).toBe('/illustrations/b1/p.png')
    expect(mediaPath('/uploads/style-refs/x.jpg?e=1#frag')).toBe('/uploads/style-refs/x.jpg')
    expect(mediaPath('/illustrations/b1/p.png#frag')).toBe('/illustrations/b1/p.png')
  })
  it('passes null and undefined through as null', () => {
    expect(mediaPath(null)).toBeNull()
    expect(mediaPath(undefined)).toBeNull()
  })
  it('only strips a non-media string', () => {
    expect(mediaPath('https://x.test/a.png?e=1')).toBe('https://x.test/a.png')
    expect(mediaPath('')).toBe('')
  })
})

describe('mediaExpiresAt', () => {
  it('returns epoch ms for an integer e', () => {
    expect(mediaExpiresAt('/illustrations/b/p.png?e=1700000000&s=abc')).toBe(1700000000000)
    expect(mediaExpiresAt('/illustrations/b/p.png?s=abc&e=60')).toBe(60000)
  })
  it('returns null when e is missing, malformed, or there is no query', () => {
    expect(mediaExpiresAt('/illustrations/b/p.png')).toBeNull()
    expect(mediaExpiresAt('/illustrations/b/p.png?s=abc')).toBeNull()
    expect(mediaExpiresAt('/illustrations/b/p.png?e=abc')).toBeNull()
    expect(mediaExpiresAt('/illustrations/b/p.png?e=1.5')).toBeNull()
    expect(mediaExpiresAt('/illustrations/b/p.png?e=')).toBeNull()
    expect(mediaExpiresAt('/illustrations/b/p.png?e=-5')).toBeNull()
    expect(mediaExpiresAt(null)).toBeNull()
    expect(mediaExpiresAt(undefined)).toBeNull()
  })
})

describe('constants', () => {
  it('exposes the param names, roots and path regex', () => {
    expect(MEDIA_EXPIRES_PARAM).toBe('e')
    expect(MEDIA_SIG_PARAM).toBe('s')
    expect([...MEDIA_ROOTS]).toEqual(['illustrations', 'uploads'])
    expect(MEDIA_PATH_RE.test('/illustrations/b/p.png')).toBe(true)
    expect(MEDIA_PATH_RE.test('/uploads/style-refs/x.jpg')).toBe(true)
    expect(MEDIA_PATH_RE.test('/hero/b/p.png')).toBe(false)
  })
})
