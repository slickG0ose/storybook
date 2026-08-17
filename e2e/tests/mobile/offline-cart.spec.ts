import { test, expect, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, forEachTheme } from './_helpers';

/**
 * Offline cart at mobile width, in both themes.
 *
 * The design (spec §Alternatives → "Offline cart strategy") is a read-only localStorage
 * snapshot: `CartContext` writes it on every successful fetch, hydrates from it on mount,
 * and refuses mutations while the network is down rather than optimistically applying a
 * change that never reached the server. This spec asserts both halves of that.
 *
 * ── Why two different ways of cutting the network ───────────────────────────────────
 *
 * `context.setOffline(true)` cuts *everything*, including the document request. The
 * mobile projects run against the Vite dev server on :5173, where `pwa.config.ts` sets
 * `devOptions.enabled: false` — there is no service worker, so nothing can serve
 * index.html from cache. Verified empirically: `page.reload()` under `setOffline(true)`
 * on :5173 fails with `net::ERR_INTERNET_DISCONNECTED` before any assertion runs.
 *
 * So:
 *   - the mid-session half uses `context.setOffline(true)` — a genuine, total network
 *     cut, which is exactly the condition a failed mutation must survive; and
 *   - the cold-mount half aborts `**\/api/**` instead, leaving the document reachable.
 *     That reproduces what the service worker provides in production (shell from
 *     precache, API unreachable) without needing the worker itself.
 *
 * The true cold offline launch — SW-served shell *and* snapshot-hydrated cart, with the
 * whole network down — is asserted in `tests/pwa/offline-cart.spec.ts`, which runs
 * against the `vite preview` build where a worker actually exists.
 */

const QUANTITY_CONTROLS = '[aria-label="Increase quantity"], [aria-label="Decrease quantity"]';

/**
 * A fresh, empty cart without wiping the theme.
 *
 * `localStorage.clear()` would also drop `storybook-theme`, which `forEachTheme` has just
 * seeded. Removing only the cart session UUID gets a new empty cart on reload and leaves
 * the theme intact — the same pattern as money-path.spec.ts. This only ever *removes* the
 * key; CartContext reissues it. The UUID session model (CLAUDE.md guardrail) is untouched.
 */
async function resetCart(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('storybook-session'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
}

/** Everything that must be unusable while the cart is a snapshot rather than live data. */
async function expectMutationControlsDisabled(page: Page, theme: string): Promise<void> {
  for (const label of ['Increase quantity', 'Decrease quantity', 'Remove from cart']) {
    await expect(
      page.getByRole('button', { name: label }).first(),
      `[${theme}] "${label}" is still enabled while offline — a tap would fail silently`,
    ).toBeDisabled();
  }

  // A <Link> renders an <a>, which cannot be disabled. Offline must swap in a real
  // <button disabled>, so the link is gone entirely rather than merely unclickable.
  await expect(
    page.getByRole('link', { name: 'Proceed to Checkout' }),
    `[${theme}] the checkout <Link> is still in the DOM while offline`,
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
}

test.describe('Offline cart on mobile', () => {
  // Two full passes (one per theme), each with an add, a failed mutation and a reload.
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
  });

  test('keeps the saved cart readable and refuses mutations while offline', async ({ page, context }) => {
    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        await resetCart(page);

        const title = (await page.getByRole('heading', { level: 3 }).first().textContent())?.trim();
        expect(title, 'no catalog card rendered a title').toBeTruthy();

        await page.getByRole('button', { name: 'Add to Cart' }).first().click();
        await expect(page.locator('nav .bg-red-500')).toHaveText('1');

        await page.goto('/cart');
        await expect(page.getByText(title!)).toBeVisible();
        await expect(page.getByTestId('cart-quantity')).toHaveText('1');
        // Online, nothing about the page changes: no banner, and checkout is a real link.
        await expect(page.getByTestId('offline-banner')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Proceed to Checkout' })).toBeVisible();

        // ── Mid-session, total network cut ──────────────────────────────────────────
        await context.setOffline(true);
        try {
          await page.getByRole('button', { name: 'Increase quantity' }).click();

          const banner = page.getByTestId('offline-banner');
          await expect(banner).toBeVisible();
          await expect(banner).toContainText(/You're offline\. Showing your saved cart/);

          // The load-bearing assertion: no optimistic update. The quantity the user sees
          // is still the one the server last confirmed, not the one the tap asked for.
          await expect(
            page.getByTestId('cart-quantity'),
            `[${theme}] the quantity moved to 2 on a request that never reached the server`,
          ).toHaveText('1');

          await expectMutationControlsDisabled(page, theme);
          await expectNoHorizontalOverflow(page);
        } finally {
          await context.setOffline(false);
        }

        // Reconnecting and reloading returns the page to normal — the offline state is a
        // report of the network, not a mode the cart gets stuck in.
        await page.reload();
        await expect(page.getByTestId('offline-banner')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeEnabled();

        // ── Cold mount with the API unreachable ─────────────────────────────────────
        await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
        try {
          await page.reload();

          // Nothing here came from the network: the items are the localStorage snapshot,
          // rendered before (and instead of) any successful fetch.
          await expect(
            page.getByText(title!),
            `[${theme}] the cart did not hydrate from its snapshot on a cold offline mount`,
          ).toBeVisible();
          await expect(page.getByTestId('cart-quantity')).toHaveText('1');
          await expect(page.getByText(/\$\d+\.\d{2} each/)).toBeVisible();

          const banner = page.getByTestId('offline-banner');
          await expect(banner).toBeVisible();
          await expect(banner).toContainText(/Showing your saved cart from .+ ago\./);

          await expectMutationControlsDisabled(page, theme);
          await expectNoHorizontalOverflow(page);
        } finally {
          await page.unroute('**/api/**');
        }
      });
    });
  });
});
