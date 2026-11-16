import { useState } from 'react'
import type { ImgHTMLAttributes, ReactNode } from 'react'
import { api } from '../lib/apiBase'
import { useImageFallback } from '../hooks/useImageFallback'

interface FallbackImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  /** Stored, un-prefixed URL (`book.cover_url`, `page.illustration_url`). */
  url: string | null | undefined
  /** Rendered when there is no URL **or** the image fails to load. */
  fallback: ReactNode
}

/**
 * An `<img>` that swaps to `fallback` when its URL is missing or does not load.
 *
 * Every book cover goes through this, with the `cover_emoji` as the fallback, so a
 * cover whose file is gone looks identical to a book that never had one. Sites where a
 * failed image changes more than the picture itself (a page illustration also swaps
 * its owner controls) use `useImageFallback` directly instead.
 */
export default function FallbackImage({ url, fallback, alt, className, ...img }: FallbackImageProps) {
  const { src, onError } = useImageFallback(url)
  // Fade the picture in once it has decoded, instead of painting it top-to-bottom over
  // the placeholder colour. `loadedSrc` rather than a boolean, so a changed URL starts
  // hidden again without an effect. The ref callback covers an image that was already
  // complete (from cache) before React attached `onLoad`.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  if (!src) return <>{fallback}</>
  const shown = loadedSrc === src
  return (
    <img
      {...img}
      ref={el => { if (el?.complete && el.naturalWidth > 0 && !shown) setLoadedSrc(src) }}
      src={api(src)}
      alt={alt}
      onLoad={() => setLoadedSrc(src)}
      onError={onError}
      className={`${className ?? ''} transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
    />
  )
}
