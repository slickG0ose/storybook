import { test, expect } from '@playwright/test';
import { PRIMARY_TAP_MIN, expectNoHorizontalOverflow, expectTapTargets, forEachTheme } from './_helpers';
import {
  BOOK_ID,
  MIXED_PAGES,
  deleteUsers,
  installBookMocks,
  registerOwner,
  seedAuth,
  type RegisteredUser,
} from '../_editPublished';

/**
 * Reader view's per-page control row at mobile width, both viewports, both themes (#144).
 *
 * WHAT THIS PINS. The row is an `<input>` beside `Regenerate` and `History`, and it used to
 * blow the document out to **464px on a 393px screen**. A flex item's default
 * `min-width: auto` will not shrink below its intrinsic width, and a bare
 * `<input type="text">` carries a ~175px one, so the input held its floor and shoved two
 * `whitespace-nowrap` buttons off the edge. `expectNoHorizontalOverflow` catches exactly
 * this shape — unlike #124, where the offending child was clipped by an ancestor and the
 * document never grew.
 *
 * WHY IT IS WORTH A SPEC OF ITS OWN. The overflow had a second-order effect that cost real
 * debugging time: Chromium's mobile emulation answers it with shrink-to-fit, inflating the
 * layout viewport, so every `position: fixed` element on the page then measures too wide and
 * looks like the culprit. `error-toast.spec.ts` had to work around precisely that. A
 * regression here would send the next person down the same wrong path, so it gets an
 * assertion that names the real cause.
 *
 * WHICH HALF OF DONE-CRITERION #2 THIS CLAIMS. **Correctness only** (ADR-009) — that the
 * page fits the screen and the controls stay tappable, in both themes. Whether a stacked
 * input-then-buttons row reads well is the aesthetic half and needs a human.
 *
 * WHY THE 44px FLOOR AND NOT THE 24px ONE (#154). `Regenerate` spends ~$0.04 on a real image
 * generation per press, so a mis-tap costs the user money — `PRIMARY_TAP_MIN`, not the
 * `NAV_TAP_MIN` reserved for navbar chrome. `History` is free but shares the row and matches.
 * Both measured 36px when this spec was first written; the assertion below is what holds them.
 *
 * NO PAID CALL IS MADE. The book is fully mocked via `../_editPublished.ts`; nothing here
 * touches `POST /:id/illustrate`, and nothing may be changed to.
 */

/**
 * The two controls in the row. Named by text rather than a testid, matching the sibling
 * specs.
 *
 * Stated precisely, because the obvious reading is wrong: `has-text` is Playwright
 * SUBSTRING matching, not the explicit two-element list it looks like. It matches exactly
 * two controls today only because the fixture makes it so — `_editPublished.ts` gives the
 * character `Pip` no `portrait_url`, so the cast-panel button renders `Generate portrait
 * ($0.04)` rather than `Regenerate ($0.04)`. Give that character a portrait, a plausible
 * edit for an unrelated test, and this selector silently grows to cover a third control
 * that is still 36px and that this spec never claimed to measure.
 *
 * Left as-is rather than tightened to a testid: the failure that would produce is loud and
 * points at a real defect (tracked separately), not a false alarm. But it is a drift the
 * next reader should not have to rediscover.
 */
const CONTROL_ROW = 'button:has-text("Regenerate"), button:has-text("History")';

test.describe('Reader view control row on mobile', () => {
  test.setTimeout(120_000);

  let user: RegisteredUser;
  const createdEmails: string[] = [];

  test.beforeEach(async ({ request }) => {
    user = await registerOwner(request, 'reader-view-mobile');
    createdEmails.push(user.email);
  });

  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  test('the per-page control row does not push the page wider than the screen', async ({ page }) => {
    await installBookMocks(page, {
      status: 'draft',
      createdBy: user.id,
      pages: MIXED_PAGES,
      token: user.token,
    });

    // The per-page history fetch reader view fires on mount. Empty is the honest answer for
    // a mocked book, and mocking it keeps a 404 from the real server out of the run.
    await page.route(`**/api/books/${BOOK_ID}/illustrations/*`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await seedAuth(page, user);
    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        // Inside the theme body, not before it: `forEachTheme` reloads to seed the theme,
        // and the view mode is React state with no URL or localStorage backing, so a reload
        // drops back to spread view. Switching before the loop would silently measure the
        // wrong view on both passes.
        await page.getByRole('button', { name: /reader view/i }).click();

        // The control row only renders for an owner on a draft page that already has art —
        // if this is not visible the assertions below would pass vacuously.
        await expect(
          page.getByRole('button', { name: /^Regenerate$/ }).first(),
          `[${theme}] the per-page control row never rendered, so the overflow check proves nothing`,
        ).toBeVisible();

        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, CONTROL_ROW, PRIMARY_TAP_MIN);
      });
    });
  });
});
