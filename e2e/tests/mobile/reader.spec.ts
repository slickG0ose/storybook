import { test, expect, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme, PRIMARY_TAP_MIN } from './_helpers';

/**
 * The reader (`BookSpread`) at mobile width, under both mobile viewport projects and in
 * both themes.
 *
 * Why this spec exists on top of smoke.spec.ts: `/book/:id` never tripped the
 * horizontal-overflow assertion. The `grid grid-cols-2` spread *shrank* to fit — two
 * ~150px columns, each losing a further 56px to the `pl-14`/`pr-14` gutter that keeps
 * the floating chevrons off the text. The page was structurally fine and behaviourally
 * unreadable, and overflow is blind to that distinction.
 *
 * What can see it is a count: below `md` exactly one page panel is on screen. Everything
 * else here guards the things that could plausibly break while making that true —
 * that navigation still steps one page at a time rather than skipping, that only one set
 * of page controls exists in the DOM, and that the controls are tappable.
 */

/** Seeded 5-page book; the same fixture the desktop book-detail spec reads. */
const BOOK_PATH = '/book/luna-star-garden';

/** The two page-turn controls. Money-path-adjacent enough to hold to the 44px HIG bar. */
const PAGE_NAV = '[aria-label="Previous spread"], [aria-label="Next spread"]';

/**
 * The page number printed on the page the reader is currently showing — read from the
 * panel itself, not from the footer, so it reflects what a reader would actually see.
 * Returns null on the cover and end spreads, which carry no page number.
 */
async function visiblePageNumber(page: Page): Promise<number | null> {
  const marker = page.getByTestId('page-number');
  if ((await marker.count()) === 0) return null;
  const text = (await marker.textContent()) ?? '';
  const match = /(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

test.describe('Reader on mobile', () => {
  // Two full read-throughs (one per theme) with a 250ms page-flip between each step.
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BOOK_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');
  });

  test('shows one page panel and steps one page at a time in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

        // The defining assertion of single-page mode: one panel, not a two-column spread.
        await expect(
          page.getByTestId('book-page-panel'),
          `[${theme}] the reader is still rendering a multi-panel spread at mobile width`,
        ).toHaveCount(1);

        // The desktop overlay chevrons and the mobile control bar must never coexist —
        // duplicated accessible names would make every page-turn selector ambiguous.
        await expect(page.getByRole('button', { name: 'Next spread' })).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Previous spread' })).toHaveCount(1);

        await expect(page.getByTestId('spread-position')).toHaveText('Cover');
        expect(await visiblePageNumber(page), 'the cover spread should carry no page number').toBeNull();
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, PAGE_NAV, PRIMARY_TAP_MIN);

        const next = page.getByRole('button', { name: 'Next spread' });
        const previous = page.getByRole('button', { name: 'Previous spread' });

        // Cover -> first story page.
        await next.click();
        await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');
        const first = await visiblePageNumber(page);
        expect(first, `[${theme}] no page number rendered on the first story page`).toBe(1);
        await expect(page.getByTestId('book-page-panel')).toHaveCount(1);
        await expectNoHorizontalOverflow(page);

        // One tap of Next must advance exactly one page. A layout that paired pages up
        // to fill the panel would step by two here, and this is what catches it.
        await next.click();
        await expect(page.getByTestId('spread-position')).toHaveText('Page 2 of 5');
        const second = await visiblePageNumber(page);
        expect(
          second! - first!,
          `[${theme}] Next advanced from page ${first} to page ${second} — one tap must move exactly one page`,
        ).toBe(1);
        await expect(page.getByTestId('book-page-panel')).toHaveCount(1);
        await expectNoHorizontalOverflow(page);

        // And Previous must reverse that step exactly, not jump back further.
        await previous.click();
        await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');
        const back = await visiblePageNumber(page);
        expect(
          second! - back!,
          `[${theme}] Previous moved from page ${second} to page ${back} — it must reverse one page`,
        ).toBe(1);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, PAGE_NAV, PRIMARY_TAP_MIN);
      });
    });
  });

  test('hides the jump-to-spread dots rather than shipping 10px tap targets', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        // Deliberate: the dots are 2.5x2.5 (10px) and a 5-page book needs 7 of them, so
        // sizing them to 44px would cost ~300px of a 360px screen. The narrow layout
        // navigates with the 48px chevrons and reads position from the footer label.
        // If someone later un-hides them, this fails rather than silently regressing
        // the tap-target floor.
        const dots = page.getByRole('button', { name: /^Go to spread \d+$/ });
        await expect(dots.first(), `[${theme}] the jump-to-spread dots are visible at mobile width`).toBeHidden();
        await expect(page.getByTestId('spread-position')).toBeVisible();
      });
    });
  });
});
