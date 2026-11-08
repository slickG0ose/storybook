// Tester feedback submit path (spec: .code-captain/specs/tester-feedback-widget/).
// Pure context building plus one fetch — no React, so it is unit-testable on its own.
import { matchPath } from 'react-router-dom'
import { api } from './apiBase'
import type { FeedbackCreateRequest, FeedbackCreateResponse } from '../types'

// Values, not types, so they cannot ride the types-only client/src/types.ts barrel
// (the lib/ageRanges.ts precedent).
export { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX } from '@storybook/shared'

export type FeedbackContext = Omit<FeedbackCreateRequest, 'category' | 'message'>

export function buildFeedbackContext(input: {
  pathname: string
  search: string
  dark: boolean
  sessionId: string
  viewport: { width: number; height: number }
  build: string | undefined
  recentErrors: string[]
}): FeedbackContext {
  return {
    route: `${input.pathname}${input.search}`,
    book_id: matchPath({ path: '/book/:id' }, input.pathname)?.params.id ?? null,
    session_id: input.sessionId,
    viewport_width: Math.round(input.viewport.width),
    viewport_height: Math.round(input.viewport.height),
    theme: input.dark ? 'dark' : 'light',
    client_build: input.build ?? null,
    recent_errors: [...input.recentErrors],
  }
}

export type SubmitResult =
  | { ok: true; data: FeedbackCreateResponse }
  | { ok: false; kind: 'auth' | 'rate' | 'invalid' | 'network'; message: string }

const GENERIC_FAILURE = "Couldn't send that. Your message is still here — try again."

async function readError(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // Non-JSON error body: the caller falls back to its own copy.
  }
  return null
}

export async function submitFeedback(
  token: string,
  body: FeedbackCreateRequest,
): Promise<SubmitResult> {
  let res: Response
  try {
    res = await fetch(api('/api/feedback'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, kind: 'network', message: GENERIC_FAILURE }
  }

  if (res.ok) {
    try {
      const data = (await res.json()) as FeedbackCreateResponse
      return { ok: true, data }
    } catch {
      return { ok: false, kind: 'network', message: GENERIC_FAILURE }
    }
  }

  if (res.status === 401) {
    return { ok: false, kind: 'auth', message: 'Your session has ended — sign in again, then send.' }
  }
  if (res.status === 429) {
    return { ok: false, kind: 'rate', message: (await readError(res)) ?? GENERIC_FAILURE }
  }
  if (res.status === 400) {
    return { ok: false, kind: 'invalid', message: (await readError(res)) ?? GENERIC_FAILURE }
  }
  return { ok: false, kind: 'network', message: GENERIC_FAILURE }
}
