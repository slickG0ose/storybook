import { test, expect } from '@playwright/test';
import { waitForActiveWorker, waitForController } from './_helpers';

/**
 * The cold offline launch: service-worker shell **and** localStorage cart, with the whole
 * network cut.
 *
 * This is the one place the two halves of Movement 3 meet. `tests/mobile/offline-cart.spec.ts`
 * covers the behaviour at mobile width in both themes, but it runs against the :5173 dev
 * server where `devOptions.enabled: false` means there is no worker — a `page.reload()`
 * under `context.setOffline(true)` there dies with `net::ERR_INTERNET_DISCONNECTED` before
 * React ever boots, so it aborts `**\/api/**` instead. Only here, against the `vite preview`
 * build, can the document itself come from the precache.
 *
 * install.spec.ts proves the shell survives; this proves the *cart* does.
 */
test.describe('Offline cart on a cold launch', () => {
  test('renders the saved cart from localStorage when the network is gone', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();

    const title = (await page.getByRole('heading', { level: 3 }).first().textContent())?.trim();
    expect(title, 'no catalog card rendered a title').toBeTruthy();

    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    await expect(page.locator('nav .bg-red-500')).toHaveText('1');

    await page.goto('/cart');
    await expect(page.getByText(title!)).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);

    await waitForActiveWorker(page);
    // Claim this client while still online — cutting the network first would send the
    // reload to a dead server rather than to the worker.
    await page.reload();
    await waitForController(page);
    await expect(page.getByText(title!)).toBeVisible();

    await context.setOffline(true);
    try {
      await page.reload();

      // Shell from the Workbox precache; cart from the localStorage snapshot. Neither
      // came from the network, because there is no network.
      await expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible();
      await expect(
        page.getByText(title!),
        'the cold offline launch lost the cart the user had already seen',
      ).toBeVisible();
      await expect(page.getByTestId('cart-quantity')).toHaveText('1');

      const banner = page.getByTestId('offline-banner');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/You're offline\. Showing your saved cart from .+ ago\./);

      await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Remove from cart' })).toBeDisabled();
      await expect(page.getByRole('link', { name: 'Proceed to Checkout' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
    } finally {
      await context.setOffline(false);
    }
  });
});
