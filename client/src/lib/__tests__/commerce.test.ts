import { describe, it, expect, afterEach, vi } from 'vitest'
import { commerceEnabled, parseCommerceFlag } from '../commerce'

describe('parseCommerceFlag', () => {
  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ["'true'", 'true'],
    ['an unrecognised value', 'banana'],
  ])('is on for %s', (_label, raw) => {
    expect(parseCommerceFlag(raw)).toBe(true)
  })

  it.each(['false', '0', 'off', 'no'])("is off for '%s'", (raw) => {
    expect(parseCommerceFlag(raw)).toBe(false)
  })

  it('ignores case and surrounding whitespace on an off value', () => {
    expect(parseCommerceFlag(' FALSE ')).toBe(false)
  })
})

describe('commerceEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is on by default', () => {
    expect(commerceEnabled()).toBe(true)
  })

  it('follows a stubbed env value and recovers when the stub is removed', () => {
    vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')
    expect(commerceEnabled()).toBe(false)

    vi.unstubAllEnvs()
    expect(commerceEnabled()).toBe(true)
  })
})
