import { test, expect, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme, PRIMARY_TAP_MIN } from './_helpers';

/**
 * The money path at mobile width: home -> add to cart -> cart -> checkout -> confirmation,
 * run end to end under both mobile viewport projects and in both themes.
 *
 * Why this spec exists on top of smoke.spec.ts: `/cart` and `/checkout` never tripped the
 * horizontal-overflow assertion, at 360px or 393px, before or after Task 3. The Cart item
 * row was a single un-wrapping `flex items-center gap-4` whose children *shrink* rather
 * than overflow, so it squeezed the title column to 56px and left 32x32 / 18x18 controls
 * instead of pushing the document wider. Overflow is structurally blind to that. The
 * assertions below — tap-target floors, the stacking geometry, and the title column's
 * share of the viewport — are what can actually see it.
 */

/** The three cart controls a mis-tap costs the user something on. Held to the 44px HIG bar. */
const CART_CONTROLS =
  '[aria-label="Increase quantity"], [aria-label="Decrease quantity"], [aria-label="Remove from cart"]';

/**
 * A fresh, empty cart without wiping the theme.
 *
 * `localStorage.clear()` — the isolation pattern in docs/conventions/testing.md — would
 * also drop `storybook-theme`, which `forEachTheme` has just seeded. Dropping only the
 * cart session UUID gets a new empty cart on reload and leaves the theme intact.
 * This only ever *removes* the key; CartContext reissues it. The UUID session model
 * (CLAUDE.md guardrail) is untouched.
 */
async function resetCart(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('storybook-session'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
}

test.describe('Money path on mobile', () => {
  // Two full purchase flows (one per theme) in a single test; the 30s default is tight.
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
  });

  test('completes add -> cart -> checkout -> confirmation in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        const viewport = page.viewportSize()!;

        await resetCart(page);
        await expectNoHorizontalOverflow(page);

        const title = (await page.getByRole('heading', { level: 3 }).first().textContent())?.trim();
        expect(title, 'no catalog card rendered a title').toBeTruthy();

        await page.getByRole('button', { name: 'Add to Cart' }).first().click();
        await expect(page.locator('nav .bg-red-500')).toHaveText('1');

        await page.goto('/cart');
        await expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible();
        await expect(page.getByText(title!)).toBeVisible();
        await expect(page.getByText(/\$\d+\.\d{2} each/)).toBeVisible();
        await expectNoHorizontalOverflow(page);

        await expectTapTargets(page, CART_CONTROLS, PRIMARY_TAP_MIN);

        // The item row must stack: the quantity/price/remove group sits on its own line
        // below the thumbnail + title block, rather than sharing one squeezed row.
        const titleLink = page.getByRole('link', { name: title! }).first();
        const detailsBox = await titleLink.evaluate((el) => {
          const rect = el.parentElement!.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, width: rect.width };
        });
        const controlsBox = await page.getByRole('button', { name: 'Decrease quantity' }).first().boundingBox();
        expect(controlsBox, 'the decrease-quantity control has no layout box').not.toBeNull();
        expect(
          controlsBox!.y,
          `[${theme}] cart item row did not stack: the quantity controls start at y=${controlsBox!.y.toFixed(1)}px, ` +
            `above the bottom of the title block (${detailsBox.bottom.toFixed(1)}px) — they are still sharing one row`,
        ).toBeGreaterThanOrEqual(detailsBox.bottom - 1);
        expect(
          detailsBox.width,
          `[${theme}] the item title column is only ${detailsBox.width.toFixed(1)}px of a ${viewport.width}px ` +
            'viewport — the row is squeezing it rather than stacking',
        ).toBeGreaterThan(viewport.width * 0.5);

        await page.getByRole('link', { name: 'Proceed to Checkout' }).click();
        await expect(page).toHaveURL(/\/checkout$/);
        await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, 'main form button[type="submit"]', PRIMARY_TAP_MIN);

        await page.locator('input[type="text"]').fill('Mobile Tester');
        await page.locator('input[type="email"]').fill('mobile@example.com');
        await expectNoHorizontalOverflow(page);

        await page.getByRole('button', { name: 'Place Order' }).click();

        await expect(page).toHaveURL(/\/order\/.+/);
        await expect(page.getByText('Order Confirmed!')).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    });
  });
});
