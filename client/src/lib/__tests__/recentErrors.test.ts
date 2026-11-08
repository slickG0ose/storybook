import { describe, it, expect, afterEach } from 'vitest'
import { FEEDBACK_RECENT_ERRORS_MAX, FEEDBACK_RECENT_ERROR_CHARS } from '@storybook/shared'
import {
  describeReason,
  getRecentErrors,
  installRecentErrorCapture,
  recordRecentError,
  resetRecentErrors,
} from '../recentErrors'

// jsdom has no PromiseRejectionEvent constructor; a plain Event carrying `reason`
// is what the listener reads.
function rejection(reason: unknown): Event {
  const event = new Event('unhandledrejection')
  Object.defineProperty(event, 'reason', { value: reason })
  return event
}

afterEach(() => {
  resetRecentErrors()
})

describe('recent error ring buffer', () => {
  it('keeps only the last FEEDBACK_RECENT_ERRORS_MAX messages, oldest first', () => {
    for (let i = 1; i <= FEEDBACK_RECENT_ERRORS_MAX + 2; i++) recordRecentError(`err ${i}`)
    expect(getRecentErrors()).toEqual(['err 3', 'err 4', 'err 5', 'err 6', 'err 7'])
    expect(FEEDBACK_RECENT_ERRORS_MAX).toBe(5)
  })

  it('truncates each message to FEEDBACK_RECENT_ERROR_CHARS', () => {
    recordRecentError('x'.repeat(FEEDBACK_RECENT_ERROR_CHARS + 50))
    expect(getRecentErrors()[0]).toHaveLength(FEEDBACK_RECENT_ERROR_CHARS)
  })

  it('returns a copy the caller cannot mutate', () => {
    recordRecentError('a')
    getRecentErrors().push('b')
    expect(getRecentErrors()).toEqual(['a'])
  })

  it('captures window error events by message', () => {
    installRecentErrorCapture()
    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: x is undefined' }))
    expect(getRecentErrors()).toEqual(['Uncaught TypeError: x is undefined'])
  })

  it('falls back to the error object when an error event has no message', () => {
    installRecentErrorCapture()
    window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('too far') }))
    expect(getRecentErrors()).toEqual(['RangeError: too far'])
  })

  it('captures an unhandled rejection whose reason is an Error', () => {
    installRecentErrorCapture()
    window.dispatchEvent(rejection(new TypeError('fetch failed')))
    expect(getRecentErrors()).toEqual(['Unhandled rejection: TypeError: fetch failed'])
  })

  it('captures an unhandled rejection whose reason is not an Error', () => {
    installRecentErrorCapture()
    window.dispatchEvent(rejection('plain string'))
    window.dispatchEvent(rejection({ code: 42 }))
    window.dispatchEvent(rejection(undefined))
    expect(getRecentErrors()).toEqual([
      'Unhandled rejection: plain string',
      'Unhandled rejection: {"code":42}',
      'Unhandled rejection: undefined',
    ])
  })

  it('truncates a long rejection message too', () => {
    installRecentErrorCapture()
    window.dispatchEvent(rejection(new Error('y'.repeat(1000))))
    expect(getRecentErrors()[0]).toHaveLength(FEEDBACK_RECENT_ERROR_CHARS)
  })

  it('is idempotent: installing twice does not double-count', () => {
    installRecentErrorCapture()
    installRecentErrorCapture()
    window.dispatchEvent(new ErrorEvent('error', { message: 'once' }))
    expect(getRecentErrors()).toEqual(['once'])
  })

  it('stops capturing after uninstall', () => {
    const uninstall = installRecentErrorCapture()
    uninstall()
    window.dispatchEvent(new ErrorEvent('error', { message: 'ignored' }))
    expect(getRecentErrors()).toEqual([])
  })
})

describe('describeReason', () => {
  it('handles circular objects without throwing', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(describeReason(circular)).toBe('[object Object]')
  })

  it('uses the name alone for an Error with no message', () => {
    expect(describeReason(new Error())).toBe('Error')
  })
})
