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
export default function FallbackImage({ url, fallback, alt, ...img }: FallbackImageProps) {
  const { src, onError } = useImageFallback(url)
  if (!src) return <>{fallback}</>
  return <img {...img} src={api(src)} alt={alt} onError={onError} />
}
