import {
  NarrationGenerateResponseSchema,
  NarrationGetResponseSchema,
  NarrationVoicesResponseSchema,
  slotKey,
  type NarrationGenerateRequest,
  type NarrationGenerateResponse,
  type NarrationGetResponse,
  type NarrationSlot,
  type NarrationVoiceId,
  type NarrationVoicesResponse,
} from '@storybook/shared'
import { api } from '../apiBase'

/**
 * Typed client for the three narration routes (generated-narration spec, Task 6).
 *
 * Every response is `safeParse`d against its `@storybook/shared` schema, so a drifted or
 * truncated body surfaces as a `NarrationApiError` the provider can map to a fallback,
 * rather than as an `undefined` deep inside playback.
 *
 * Note what `postNarration` does *not* take: any text. The server derives what to speak
 * from the book (spec §Constraints, "no client text on paid routes").
 */

/** `status` is the HTTP status, or `null` for a network failure / unparseable body. */
export class NarrationApiError extends Error {
  readonly status: number | null

  constructor(status: number | null, message: string) {
    super(message)
    this.name = 'NarrationApiError'
    this.status = status
  }
}

/**
 * Structural stand-in for a Zod schema, so the client needs no direct `zod` dependency —
 * the schemas themselves come from `@storybook/shared`.
 */
interface ParsesTo<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

async function readJson<T>(res: Response, schema: ParsesTo<T>, what: string): Promise<T> {
  if (!res.ok) throw new NarrationApiError(res.status, `${what}: HTTP ${res.status}`)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new NarrationApiError(null, `${what}: response was not JSON`)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new NarrationApiError(null, `${what}: response did not match schema`)
  return parsed.data
}

async function send(fetchImpl: typeof fetch, url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetchImpl(url, init)
  } catch {
    throw new NarrationApiError(null, `${what}: network error`)
  }
}

/** `GET /api/narration/voices` — public; `available: false` means "use the device voice". */
export async function fetchVoices(fetchImpl: typeof fetch = fetch): Promise<NarrationVoicesResponse> {
  const res = await send(fetchImpl, api('/api/narration/voices'), {}, 'voices')
  return readJson(res, NarrationVoicesResponseSchema, 'voices')
}

/** `GET /api/books/:id/narration` — free; never generates. `missing` on a cache miss. */
export async function getNarration(
  bookId: string,
  slot: NarrationSlot,
  voiceId: NarrationVoiceId,
  fetchImpl: typeof fetch = fetch,
): Promise<NarrationGetResponse> {
  const query = new URLSearchParams({ voice: voiceId, slot: String(slot) })
  const url = api(`/api/books/${encodeURIComponent(bookId)}/narration?${query.toString()}`)
  const res = await send(fetchImpl, url, {}, `narration ${slotKey(slot)}`)
  return readJson(res, NarrationGetResponseSchema, `narration ${slotKey(slot)}`)
}

/** `POST /api/books/:id/narration` — paid, billed to the bearer of `token`. */
export async function postNarration(
  bookId: string,
  request: NarrationGenerateRequest,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NarrationGenerateResponse> {
  // Built field by field so nothing else a caller had on the object can reach the wire —
  // the route is `.strict()` and would 400 on it anyway.
  const body: NarrationGenerateRequest = { voiceId: request.voiceId, slot: request.slot }
  const res = await send(
    fetchImpl,
    api(`/api/books/${encodeURIComponent(bookId)}/narration`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    `generate ${slotKey(request.slot)}`,
  )
  return readJson(res, NarrationGenerateResponseSchema, `generate ${slotKey(request.slot)}`)
}
