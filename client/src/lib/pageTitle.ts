/**
 * Per-route document titles.
 *
 * Every page used to share the one title from index.html, so browser tabs, history
 * entries and bookmarks were indistinguishable, and a screen reader announced the same
 * thing on every navigation. The home page keeps the index.html title verbatim (it is
 * the one scrapers and the installed PWA see).
 */
export const SITE_NAME = 'StoryBook'
export const HOME_TITLE = "StoryBook — AI children's books"

const EXACT: Record<string, string> = {
  '/login': 'Sign in',
  '/register': 'Create account',
  '/create': 'Create a book',
  '/my-books': 'My books',
  '/admin': 'Admin',
  '/privacy': 'Privacy',
  '/cart': 'Cart',
  '/checkout': 'Checkout',
}

export function withSiteName(page: string): string {
  return `${page} · ${SITE_NAME}`
}

/** `known` is false for a path no route renders, which gets the not-found title. */
export function titleForPath(pathname: string, known = true): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path === '/' || path === '') return HOME_TITLE
  if (!known) return withSiteName('Page not found')
  if (EXACT[path]) return withSiteName(EXACT[path])
  // The book page replaces this with the book's own title once it has loaded.
  if (path.startsWith('/book/')) return withSiteName('Book')
  if (path.startsWith('/order/')) return withSiteName('Order confirmed')
  return withSiteName('Page not found')
}
