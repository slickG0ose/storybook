import { BookOpenCheck, Sparkles } from 'lucide-react'

/** How long the moment holds before the new book opens. */
export const BOOK_READY_HOLD_MS = 1100

/**
 * True when motion should be skipped. Also true where `matchMedia` does not exist, so
 * anything that cannot answer the question gets the calm path.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Eight sparkles on a ring, flying outward. Fixed, not random: the burst should look
// the same every time and be identical between a render and a re-render.
const SPARKLES = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2 - Math.PI / 2
  return {
    dx: `${Math.round(Math.cos(angle) * 64)}px`,
    dy: `${Math.round(Math.sin(angle) * 64)}px`,
    delay: `${120 + (i % 4) * 30}ms`,
    size: i % 2 === 0 ? 18 : 12,
  }
})

/**
 * The second between "the story is written" and the book opening: the wait just ended
 * and something was made, so say so before changing the page. Replaces the
 * "Creating your story..." card in place, so nothing jumps.
 *
 * The sparkles are decoration (`aria-hidden`); the sentence is a polite live region,
 * which is the whole moment for a screen-reader user. Callers skip this entirely under
 * reduced motion and open the book at once.
 */
export default function BookReadyMoment({ name }: { name?: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 sm:py-20 text-center">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-8 sm:p-12 transition-colors">
        <div className="relative mx-auto mb-6 h-16 w-16">
          <div className="animate-pop-in flex h-16 w-16 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-200">
            <BookOpenCheck size={32} aria-hidden="true" />
          </div>
          {SPARKLES.map((s, i) => (
            <Sparkles
              key={i}
              size={s.size}
              aria-hidden="true"
              className="animate-sparkle-out pointer-events-none absolute left-1/2 top-1/2 -ml-2 -mt-2 text-amber-500 dark:text-amber-300"
              style={{ '--dx': s.dx, '--dy': s.dy, animationDelay: s.delay } as React.CSSProperties}
            />
          ))}
        </div>
        <h2
          role="status"
          className="animate-rise-in text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2"
        >
          Your book is ready!
        </h2>
        <p className="animate-rise-in text-gray-500 dark:text-gray-400">
          {name ? `Opening ${name}'s story…` : 'Opening your story…'}
        </p>
      </div>
    </div>
  )
}
