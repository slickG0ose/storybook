import { useCallback, useState } from 'react'
import { mediaExpiresAt } from '@storybook/shared'
import { reportExpiredMedia } from '../lib/mediaRefresh'

/** A link this close to its `e` (or past it) that fails to load is treated as expired. */
const EXPIRY_SLOP_MS = 30_000

/**
 * Treats an image URL that failed to load as if it were absent.
 *
 * A stored `cover_url` / `illustration_url` can outlive its file (a pruned or lost
 * object in storage answers 404). Without this the browser paints its broken-image
 * state — an icon, or the alt text wrapped across the slot. Callers branch on the
 * returned `src` exactly as they branched on the raw URL, so a failed image renders
 * the very same thing a book or page with no image renders: there is one fallback
 * per surface, not a second "broken" design to keep in step with it.
 *
 * The failure is remembered **by URL, not as a boolean**. A re-roll or a page turn
 * hands the hook a different URL, and that one gets a fresh attempt without any
 * reset effect; the same dead URL stays suppressed instead of flickering back. This memory
 * stays keyed on the **full** URL (signature included) on purpose: an expired link that the
 * page refetches comes back as a different URL and so gets its retry.
 *
 * When the failed URL is a signed link at or near its expiry, `onError` also reports it
 * (`reportExpiredMedia`, once per URL) so the owning page can refetch fresh links.
 */
export function useImageFallback(url: string | null | undefined): {
  /** The URL to render, or `null` when there is none or it failed to load. */
  src: string | null
  /** Wire to the `<img>`'s `onError`. */
  onError: () => void
} {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const onError = useCallback(() => {
    setFailedUrl(url ?? null)
    if (!url) return
    const expiresAt = mediaExpiresAt(url)
    if (expiresAt !== null && expiresAt <= Date.now() + EXPIRY_SLOP_MS) reportExpiredMedia(url)
  }, [url])
  return { src: url && url !== failedUrl ? url : null, onError }
}
