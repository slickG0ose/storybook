import { api } from './apiBase'
import { authFetch } from './authFetch'

// Mirrors the server's slugify in routes/books.ts so the browser-side download
// filename matches the Content-Disposition the route sends. If one changes,
// change the other.
export const pdfSlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'storybook'

/** A non-2xx from `POST /api/books/:id/pdf`, carrying the status so callers can word it. */
export class PdfDownloadError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Download failed (${status})`)
    this.name = 'PdfDownloadError'
    this.status = status
  }
}

/**
 * POST /api/books/:id/pdf (signed-in only) and hand the bytes to the browser as
 * a file download. Shared by BookDetail and OrderConfirmation (#87).
 *
 * Object-URL + synthetic anchor click: the response is a stream, not a
 * navigable URL, so there's nothing to point an <a href> at directly.
 */
export async function downloadBookPdf(token: string, bookId: string, title: string): Promise<void> {
  const res = await authFetch(token, api(`/api/books/${bookId}/pdf`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new PdfDownloadError(res.status)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${pdfSlug(title)}.pdf`
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
