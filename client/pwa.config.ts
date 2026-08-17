import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * PWA options live here rather than inline in `vite.config.ts` so they can be pinned by a
 * fast Vitest unit test (`src/__tests__/pwaOptions.test.ts`) without spawning a build.
 * The manifest fields below are the ones a production deploy would break silently on.
 */
export const pwaOptions: Partial<VitePWAOptions> = {
  // 'prompt', never 'autoUpdate': autoUpdate calls skipWaiting and reloads the page when
  // the new worker takes control, which on /checkout with a filled form discards user
  // input. UpdateToast asks first.
  registerType: 'prompt',
  injectRegister: 'auto',
  includeAssets: ['icons/icon.svg', 'icons/maskable-icon.svg'],
  manifest: {
    name: 'StoryBook Storefront',
    short_name: 'StoryBook',
    description: "Create and collect one-of-a-kind AI children's books.",
    // Base-relative, NOT '/'. GitHub Pages serves this app under /storybook/ (see
    // deploy-pages.yml building with VITE_BASE_PATH=/storybook/), so an absolute
    // start_url boots the installed app straight to a 404.
    start_url: '.',
    scope: '.',
    display: 'standalone',
    background_color: '#fffbeb', // amber-50, the app's light surface
    theme_color: '#f59e0b', // amber-500, the primary CTA
    icons: [
      { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: 'icons/maskable-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],
    navigateFallback: 'index.html',
    // /api/ and /illustrations/ must reach the network untouched — there is no
    // runtimeCaching entry for either. Offline cart data comes from an explicit
    // application-level snapshot (cartCache.ts, Task 6), not from an opaque SW cache.
    navigateFallbackDenylist: [/^\/api\//, /^\/illustrations\//],
  },
  // Load-bearing: the chromium / mobile-pixel / mobile-small e2e projects all run against
  // the :5173 dev server. A service worker there would serve them stale precached assets.
  // The pwa project runs against a production build on :4173 instead.
  devOptions: { enabled: false },
};
