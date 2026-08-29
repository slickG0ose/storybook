import { test, expect } from '@playwright/test';
import { forEachTheme } from './mobile/_helpers';

/**
 * The skip-to-content link (`client/src/App.tsx`) is an `sr-only` anchor that becomes
 * visible on focus and targets `#main`. It is keyboard-only, which is exactly why it
 * needs a test: a renamed `id`, a stacking-context change, or any focusable element
 * inserted above it in the DOM defeats it with nothing turning red. See #121.
 *
 * Desktop project only. The affordance is keyboard-primary, and re-running it at the two
 * mobile viewports would repeat the same DOM-order assertion with no extra signal —
 * `forEachTheme` is imported from the mobile helpers because that is where it lives, not
 * because this is a mobile concern. Both themes do matter: the focus treatment is themed
 * (`focus:bg-purple-500 focus:text-white`).
 */
test.describe('Skip to content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Books must have landed before tabbing: a card rendering late would insert
    // focusables and change what "first tab stop" means mid-assertion.
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
  });

  test('is the first tab stop, and lands the next tab inside #main', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      // Back to a fragment-free URL first. The light pass ends on `/#main`, and
      // forEachTheme's reload would then restore the sequential focus starting point at
      // #main — the dark pass would skip the link and fail for a reason that has nothing
      // to do with the link.
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();

      const link = page.getByRole('link', { name: 'Skip to content' });
      await expect(link, `the skip link is absent in ${theme} mode`).toHaveAttribute('href', '#main');

      // Assertion 1: one Tab from a fresh load reaches it. Focus starts at the document,
      // so the first Tab must land here and not on a Navbar control.
      await page.locator('body').press('Tab');
      await expect(
        link,
        `in ${theme} mode the first tab stop was not the skip link — something focusable ` +
          'was inserted above it in the DOM',
      ).toBeFocused();

      // Assertion 2: activating it moves the tab sequence into #main. `<main>` carries no
      // tabindex, so activeElement stays on <body> after the fragment navigation — what
      // the user actually experiences is that the *next* Tab lands inside the content.
      // Asserting on that is both closer to the affordance and the thing that regresses.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      const insideMain = await page.evaluate(() => {
        const active = document.activeElement;
        const main = document.getElementById('main');
        return Boolean(active && main && main.contains(active) && active !== main);
      });
      expect(
        insideMain,
        `in ${theme} mode, tabbing after activating the skip link did not land inside #main`,
      ).toBe(true);
    });
  });

  test('#main exists and is the element wrapping the routed page', async ({ page }) => {
    const main = page.locator('main#main');
    await expect(main).toHaveCount(1);

    // Assertion 3. "Wraps <Routes>" has no DOM marker of its own, so pin the observable
    // consequence: the routed page's H1 is inside #main, and the Navbar is not — which is
    // what makes skipping to #main skip the navigation.
    await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(main.locator('nav')).toHaveCount(0);
  });

  test('is clipped until focused, then renders at a readable size', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
      const link = page.getByRole('link', { name: 'Skip to content' });

      // Assertion 4. Playwright's toBeVisible() passes on an `sr-only` element — the
      // Tailwind utility clips it to a 1x1 box rather than removing it from layout — so
      // the box size is what distinguishes hidden from shown.
      const hidden = await link.boundingBox();
      expect(hidden, `the skip link has no box at all in ${theme} mode`).not.toBeNull();
      expect(
        hidden!.width,
        `in ${theme} mode the skip link is ${Math.round(hidden!.width)}px wide unfocused — ` +
          'it should be clipped by sr-only until it receives focus',
      ).toBeLessThanOrEqual(2);

      await link.focus();
      const shown = await link.boundingBox();
      expect(
        shown!.width,
        `in ${theme} mode the skip link stayed clipped when focused — focus:not-sr-only ` +
          'did not take effect',
      ).toBeGreaterThan(40);
      expect(shown!.height).toBeGreaterThan(20);
    });
  });
});
