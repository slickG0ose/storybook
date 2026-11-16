// A browser refresh opens at the top of the page.
//
// Before this, refreshing the home page after tapping Browse (or the footer's All books)
// jumped back down to the All books section, for two reasons:
//   1. Those links leave `#browse` in the address, so the reload asked for that section
//      again: the browser's own fragment scroll, and Home's hash effect once the catalog
//      loaded.
//   2. With the default `history.scrollRestoration = 'auto'`, the browser also restores the
//      old scroll position on a reload.
// Nick found that jarring (2026-11-16), so on a reload, and only on a reload, this drops the
// hash and turns restoration off for the load. A fresh visit to a `/#browse` link still
// lands on the section, and in-app taps on Browse still scroll there.
//
// Restoration goes back to 'auto' once the page has loaded, so the back button keeps
// restoring positions as before for everything after the reload.

export type ReloadWindow = Pick<Window, 'location' | 'history' | 'addEventListener' | 'setTimeout'> & {
  performance?: Pick<Performance, 'getEntriesByType'>
}

/** True when this document was loaded by the browser's reload. */
export function isReload(win: ReloadWindow): boolean {
  const entries = win.performance?.getEntriesByType?.('navigation') as PerformanceNavigationTiming[] | undefined
  return entries?.[0]?.type === 'reload'
}

/** Call once, before the app renders. */
export function startReloadsAtTop(win: ReloadWindow = window): void {
  if (!isReload(win)) return

  if (win.location.hash) {
    // Keep React Router's state object; only the fragment goes.
    win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search)
  }

  if ('scrollRestoration' in win.history) {
    win.history.scrollRestoration = 'manual'
    win.addEventListener('load', () => {
      win.setTimeout(() => {
        win.history.scrollRestoration = 'auto'
      }, 0)
    }, { once: true })
  }
}
