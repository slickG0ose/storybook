import { test, expect } from '@playwright/test';
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme, PRIMARY_TAP_MIN } from './_helpers';
import { installFakeSpeech } from '../_speech';

/**
 * Read-aloud at mobile width, under both mobile viewport projects and in both themes.
 *
 * **This spec is the mechanical discharge of CLAUDE.md done-criterion #2 for the read-aloud
 * feature** (ADR-009): it runs the flow in both themes at a mobile viewport, asserting no
 * horizontal overflow and the 44px tap-target floor. That covers the *correctness* half of
 * "verified in light and dark mode". The *aesthetic* half — whether the bar sits well under
 * the book frame — still needs a human, and this spec does not claim it.
 *
 * The synthesiser is the injected fake from `../_speech`, so what is proven here is the
 * state machine and the layout, never audibility.
 */

/** Seeded 5-page book — the same fixture the desktop and mobile reader specs read. */
const BOOK_PATH = '/book/luna-star-garden';

/** The player's own interactive controls. Money-path-adjacent enough for the 44px HIG bar. */
const PLAYER_CONTROLS =
  '[data-testid="narration-player"] button, [data-testid="narration-player"] select';

test.describe('Read-aloud on mobile', () => {
  // Two themes x an overflow scan with the settings panel open and closed, then two themed
  // page reads in the second test. reader.spec.ts uses 90s for less than this.
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    // Before the first navigation: `addInitScript` runs per navigation, so this also
    // survives the reloads `forEachTheme` performs.
    await installFakeSpeech(page, { chunkMs: 250 });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BOOK_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');
  });

  test('fits the viewport and keeps 44px controls, panel open or closed, in either theme', async ({
    page,
  }) => {
    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        const player = page.getByTestId('narration-player');
        await expect(player).toBeVisible();

        // One instance at every breakpoint. Two copies would give two nodes the same
        // accessible name — the mistake the page-turn chevrons already had to be rescued
        // from, and what mobile/reader.spec.ts fences for those.
        await expect(
          player,
          `[${theme}] more than one narration player is mounted at mobile width`,
        ).toHaveCount(1);

        /*
         * The layout invariant, pinned deliberately: **`UpdateToast` is the app's only
         * bottom-fixed surface.** A sticky player would sit in the same ~60px of a phone
         * screen as the toast (`fixed inset-x-3 bottom-3 z-50`) on exactly the viewport
         * where both matter. If someone later wants a sticky bar, they have to delete this
         * assertion and re-open the question rather than silently shipping an occlusion bug
         * that no overflow check can see.
         */
        const position = await player.evaluate((el) => getComputedStyle(el).position);
        expect(
          position,
          `[${theme}] the narration player is bottom-fixed; UpdateToast must remain the only fixed surface`,
        ).not.toBe('fixed');

        // Closed: the default state at every breakpoint.
        await expect(page.locator('[data-testid="narration-settings"][open]')).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, PLAYER_CONTROLS, PRIMARY_TAP_MIN);

        // Open: the two <select>s and the checkbox row are the realistic overflow risk, and
        // the selects are only measurable as tap targets once they are actually rendered.
        await page.getByTestId('narration-settings').locator('summary').click();
        await expect(page.locator('[data-testid="narration-settings"][open]')).toHaveCount(1);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, PLAYER_CONTROLS, PRIMARY_TAP_MIN);
        // The disclosure trigger is a <summary>, not a <button>, so the selector above
        // cannot see it. It carries the same tap-target obligation.
        await expectTapTargets(
          page,
          '[data-testid="narration-settings"] summary',
          PRIMARY_TAP_MIN,
        );

        // Single-page mode still holds with the player mounted — the fences
        // mobile/reader.spec.ts established, re-asserted against this diff.
        await expect(page.getByTestId('book-page-panel')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Next spread' })).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Previous spread' })).toHaveCount(1);
      });
    });
  });

  test('reads a page and turns it by itself, in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        // A reload resets the reader to the cover, which has no page text to highlight.
        await page.getByRole('button', { name: 'Next spread' }).click();
        await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');

        await page.getByRole('button', { name: 'Play' }).click();

        await expect(
          page.getByTestId('narration-highlight'),
          `[${theme}] no sentence highlight appeared after Play`,
        ).toBeVisible();
        await expect(page.getByTestId('narration-highlight')).toHaveCount(1);

        // The end of the last chunk requests the turn; BookSpread honours it.
        await expect(
          page.getByTestId('spread-position'),
          `[${theme}] auto-advance did not turn the page at the end of page 1`,
        ).toHaveText('Page 2 of 5');
        await expect(page.getByTestId('book-page-panel')).toHaveCount(1);
        await expectNoHorizontalOverflow(page);

        // Stop, so the next theme pass starts from a quiet reader rather than mid-book.
        await page.getByRole('button', { name: 'Stop reading' }).click();
      });
    });
  });
});
