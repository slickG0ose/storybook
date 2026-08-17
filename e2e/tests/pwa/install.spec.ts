import { test, expect } from '@playwright/test';
import { waitForActiveWorker, waitForController } from './_helpers';

/**
 * PWA shell, against the production build served by `vite preview` on :4173.
 *
 * This is the only project that runs against a build. `pwa.config.ts` sets
 * `devOptions.enabled: false` so the :5173 dev server the chromium / mobile-pixel /
 * mobile-small projects use never registers a worker — a stale precached asset there
 * would flake the whole desktop suite.
 *
 * Everything device- or HTTPS-dependent (a real Android install prompt, iOS
 * Add-to-Home-Screen, a Lighthouse PWA audit, and whether `scope`/`start_url` resolve
 * under the /storybook/ base) is blocked on #77 and lives on the spec's deferred list,
 * not here. localhost is a secure context, so registration and offline are reachable.
 */

test.describe('PWA shell', () => {
  test('serves an installable manifest', async ({ page, request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);

    const manifest = await res.json();
    expect(manifest).toMatchObject({
      name: 'StoryBook Storefront',
      short_name: 'StoryBook',
      display: 'standalone',
      // Base-relative. '/' here would boot the installed app to a 404 under the
      // /storybook/ GitHub Pages base.
      start_url: '.',
      scope: '.',
    });
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);

    // The manifest is worthless if the document never points at it.
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  });

  test('registers and activates a service worker', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await waitForActiveWorker(page);

    const scriptURL = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg?.active?.scriptURL ?? null;
    });
    expect(scriptURL).toContain('/sw.js');
  });

  test('boots the app shell from cache with the network cut', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await waitForActiveWorker(page);

    // First reload is online: it is what puts this client under the worker's control.
    await page.reload();
    await waitForController(page);

    // The real assertion: with no network at all, the precached shell still renders
    // rather than the browser's offline error page.
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // /api/* is deliberately not cached, so book data is gone — the *shell* is what
      // survives, which is exactly what Task 6's offline cart renders into.
      await expect(page.getByRole('link', { name: 'Create a Book' })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
