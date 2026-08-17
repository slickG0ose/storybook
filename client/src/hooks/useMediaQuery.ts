import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 *
 * Exists so a component can branch on viewport width in *behaviour*, not just in
 * styling. Tailwind's `md:` variants can hide and show markup, but they cannot change
 * what a click does or how many panels a layout renders — `BookSpread`'s single-page
 * mode needs both, so it reads the breakpoint here rather than taking a prop. Keeping
 * it out of the props means no caller has to know about the breakpoint.
 *
 * jsdom does not implement `matchMedia`; `client/src/test/setup.ts` polyfills it with a
 * stub that always reports `matches: false`, so unit tests get the desktop branch unless
 * they override the mock.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches)

    // Re-read on subscribe: the query string can change between renders, and the list
    // may already disagree with state by the time this effect runs.
    setMatches(list.matches)

    // Safari < 14 only has the deprecated addListener/removeListener pair.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    }
    list.addListener(onChange)
    return () => list.removeListener(onChange)
  }, [query])

  return matches
}
