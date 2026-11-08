// Ring buffer of the most recent uncaught client errors, attached to tester feedback
// as `recent_errors` (spec: .code-captain/specs/tester-feedback-widget/, open
// question 3 — Nick: yes).
//
// It listens to `window` `error` and `unhandledrejection` only. It deliberately does
// NOT wrap console.error: that would also catch React dev warnings and third-party
// noise, and the point is "what actually broke on this page".
//
// The `error` listener is registered in the bubbling phase on purpose. Resource load
// failures (a broken <img>) fire `error` on the element and do not bubble to window,
// so they stay out of the buffer.
import { FEEDBACK_RECENT_ERRORS_MAX, FEEDBACK_RECENT_ERROR_CHARS } from '@storybook/shared'

let buffer: string[] = []
let uninstall: (() => void) | null = null

/** Turns a thrown value or rejection reason into one readable line. */
export function describeReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message ? `${reason.name}: ${reason.message}` : reason.name
  }
  if (typeof reason === 'string') return reason
  if (reason === undefined) return 'undefined'
  try {
    const json = JSON.stringify(reason)
    if (typeof json === 'string') return json
  } catch {
    // Circular or otherwise unserialisable: fall through to String().
  }
  return String(reason)
}

/** Adds one message, truncated, evicting the oldest past the cap. */
export function recordRecentError(message: string): void {
  buffer.push(message.slice(0, FEEDBACK_RECENT_ERROR_CHARS))
  if (buffer.length > FEEDBACK_RECENT_ERRORS_MAX) {
    buffer = buffer.slice(-FEEDBACK_RECENT_ERRORS_MAX)
  }
}

/** Oldest first. Returns a copy, so callers can't mutate the buffer. */
export function getRecentErrors(): string[] {
  return [...buffer]
}

/**
 * Starts capturing. Idempotent: a second call while installed is a no-op that
 * returns the same uninstaller, so a hot-reloaded main.tsx can't double-count.
 */
export function installRecentErrorCapture(target: Window = window): () => void {
  if (uninstall) return uninstall

  const onError = (event: ErrorEvent) => {
    recordRecentError(event.message || describeReason(event.error))
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    recordRecentError(`Unhandled rejection: ${describeReason(event.reason)}`)
  }

  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)

  uninstall = () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
    uninstall = null
  }
  return uninstall
}

/** Test-only: empties the buffer and removes any installed listeners. */
export function resetRecentErrors(): void {
  uninstall?.()
  buffer = []
}
