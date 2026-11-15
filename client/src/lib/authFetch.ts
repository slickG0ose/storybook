export const AUTH_EXPIRED_EVENT = 'storybook:auth-expired'
export interface AuthExpiredDetail { token: string }

/**
 * fetch with `Authorization: Bearer <token>` merged into init.headers.
 * No token -> plain fetch, no header, never dispatches.
 * 401 on a request that carried a token -> dispatches AUTH_EXPIRED_EVENT on window with
 * { token }, then returns the Response UNCHANGED so the caller's own error handling runs.
 * Never throws on its own; a rejected fetch rejects as usual. `input` is passed through as
 * given: callers keep using api('/api/...').
 */
export async function authFetch(
  token: string | null | undefined,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  if (!token) return fetch(input, init)
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) {
    window.dispatchEvent(
      new CustomEvent<AuthExpiredDetail>(AUTH_EXPIRED_EVENT, { detail: { token } }),
    )
  }
  return res
}

// Router state Login reads. Set only by AuthProvider.
export interface LoginLocationState { from?: string; reason?: 'expired' }
