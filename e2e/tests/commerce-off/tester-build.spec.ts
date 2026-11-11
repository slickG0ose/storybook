import { test, expect, type Page } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectTapTargets,
  forEachTheme,
  PRIMARY_TAP_MIN,
} from '../mobile/_helpers';

/**
 * The tester build: the storefront compiled with `VITE_COMMERCE_ENABLED=false`.
 *
 * Runs under the `commerce-off` project only (393x851, see e2e/playwright.config.ts),
 * against a production bundle on its own `vite preview` port. The flag is inlined at
 * build time, so this is the only project in which these assertions can be true — and
 * the only one that exercises the artifact testers actually get.
 *
 * DONE CRITERION #2: this spec claims the **correctness** half (ADR-009) for the
 * commerce-off surfaces — both themes at a mobile viewport, no horizontal overflow, the
 * card "Read" link at the 44px primary tap floor. It does NOT claim the aesthetic half:
 * whether a card looks right without its price still needs a human.
 *
 * Read-only against the seeded catalog. It creates and mutates nothing, so it needs no
 * serial mode and cannot collide with the other projects' workers.
 */

/** A book price as the card and book page print it: `$24.99`. */
const PRICE = /\$\d+\.\d{2}/;

/** The card CTA that takes the "Add to Cart" slot. Its accessible name is "Read <title>". */
const READ_LINK = 'main a[aria-label^="Read "]';

/** Home has rendered its catalog once the first card CTA is on screen. */
async function homeReady(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: /^Read / }).first()).toBeVisible();
}

test.describe('Commerce off: Home', () => {
  test('shows no price, no Add to Cart and no cart link, in both themes', async ({ page }) => {
    await page.goto('/');

    await forEachTheme(page, async () => {
      await homeReady(page);

      await expect(page.getByRole('button', { name: 'Add to Cart' })).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(PRICE);
      await expect(page.locator('nav').first().getByRole('link', { name: 'Cart' })).toHaveCount(0);

      await expectNoHorizontalOverflow(page);
      await expectTapTargets(page, READ_LINK, PRIMARY_TAP_MIN);
    });
  });

  test('makes no cart request on load and still issues the session id', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));

    await page.goto('/');
    await homeReady(page);

    // Proves the listener was attached in time: the catalog request is in the same list.
    expect(
      requested.some((url) => url.includes('/api/books')),
      'the request log never saw /api/books, so an absent /api/cart/ would prove nothing',
    ).toBe(true);
    expect(requested.filter((url) => url.includes('/api/cart/'))).toEqual([]);

    // FeedbackDialog sends this with every report, so it must survive with the cart gone.
    const session = await page.evaluate(() => localStorage.getItem('storybook-session'));
    expect(session, 'CartProvider no longer issues the storybook-session id').toBeTruthy();
  });
});

test.describe('Commerce off: book page', () => {
  test('the card Read link opens a book with no price and no Add to Cart, in both themes', async ({ page }) => {
    await page.goto('/');
    await homeReady(page);
    await page.getByRole('link', { name: /^Read / }).first().click();
    await expect(page).toHaveURL(/\/book\//);

    await forEachTheme(page, async () => {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      await expect(page.getByRole('button', { name: 'Add to Cart' })).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(PRICE);

      await expectNoHorizontalOverflow(page);
    });
  });
});

test.describe('Commerce off: commerce routes are not registered', () => {
  for (const path of ['/cart', '/checkout', '/order/does-not-exist']) {
    test(`${path} renders the NotFound page`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'This page wandered off' })).toBeVisible();
    });
  }
});
