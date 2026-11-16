/**
 * Turning a failed request into a sentence a parent can act on.
 *
 * Two things used to reach the screen raw. A network-layer failure rejects `fetch` with
 * a TypeError whose message is the browser's ("Failed to fetch", "Load failed",
 * "NetworkError when attempting to fetch resource."). And a non-JSON error body — the
 * HTML 502 the host serves while the API is starting — made `res.json()` throw a
 * SyntaxError ("Unexpected token '<'..."), which callers then displayed as the reason.
 */

export const UNREACHABLE_MESSAGE =
  "We couldn't reach the story server. It may be waking up, or you may be offline. Give it a moment and try again."

/** The server's own `error` text when the body has one; otherwise `fallback`. Never throws. */
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null
  if (typeof data?.error === 'string' && data.error) return data.error
  // A gateway status with no JSON body is the host answering for an API that is not up.
  return res.status === 502 || res.status === 503 || res.status === 504 ? UNREACHABLE_MESSAGE : fallback
}

/**
 * What to show for something caught around a fetch. An Error we threw ourselves (with a
 * server-provided message) passes through; a network TypeError or a JSON SyntaxError
 * becomes the unreachable sentence, never the browser's wording.
 */
export function describeFailure(err: unknown, fallback: string): string {
  if (err instanceof TypeError || err instanceof SyntaxError) return UNREACHABLE_MESSAGE
  if (err instanceof DOMException && err.name === 'AbortError') return UNREACHABLE_MESSAGE
  if (err instanceof Error && err.message) return err.message
  return fallback
}
