import { test, expect, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme, PRIMARY_TAP_MIN } from './_helpers';
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
 * The error toast host at mobile width, under both mobile viewport projects and in both
 * themes (spec: `.code-captain/specs/error-toast-host/`, issues #115 and #114).
 *
 * **The second step is #114's repro turned into an assertion.** The failure is raised by a
 * per-page Regenerate control in the reader view, hundreds of pixels below the header the
 * message used to render into. So the spec scrolls to the bottom of the page *first*, raises
 * the failure, and asserts the message is visible **without scrolling back up**. Before this
 * feature that assertion could not pass; if the host ever loses `position: fixed`, or is
 * anchored somewhere that scrolls, it stops passing again.
 *
 * **This spec is the mechanical discharge of CLAUDE.md done-criterion #2 for this feature**
 * (ADR-009) — both themes at 393px and 360px, no horizontal overflow, the 44px tap-target
 * floor on the dismiss control. That is the *correctness* half. The *aesthetic* half —
 * whether a red-bordered card floating over the reader reads as informative rather than
 * alarming — needs one human look, and this spec does not claim it.
 *
 * **No paid call is made.** `POST /:id/illustrate` is a Fal image request; it is route-mocked
 * into a 500 below, the same failure-injection pattern as `admin.spec.ts` and
 * `version-history.spec.ts`. Nothing here may be changed into a real call.
 *
 * Auth is real and the book is fully mocked, both imported from `../_editPublished.ts` rather
 * than re-derived — the reasoning, and what it costs, is documented there.
 */

const FAILURE_MESSAGE = 'Fal image request timed out after 120s';

/** Never a bare `getByRole('alert')`: inline alert nodes exist elsewhere in the app. */
const host = (page: Page) => page.getByTestId('error-toast-host');

/**
 * The explicit tap-target list, never "all buttons" (ADR-009). Scoped to the host's own
 * testid, this enumerates exactly the control this feature adds — the dismiss button — on a
 * page that also carries the navbar's 24px icon chrome and BookSpread's own controls.
 */
const HOST_CONTROLS = '[data-testid="error-toast-host"] button';

/**
 * `UpdateToast` (`fixed inset-x-3 bottom-3 z-50`) remains the app's only *bottom*-fixed
 * surface — ADR-011 decision 5, as amended by this feature's ADR. The error host is
 * top-anchored precisely so the two cannot fight over the same ~60px of a phone screen, and
 * so the `position !== 'fixed'` assertions in `narration.spec.ts` and `edit-published.spec.ts`
 * keep meaning what their comments say. This is the other half of that bargain: the host must
 * clear the sticky navbar rather than sliding under it.
 */
async function expectBelowNavbar(page: Page, theme: string): Promise<void> {
  const hostBox = await host(page).boundingBox();
  const navBox = await page.locator('nav').first().boundingBox();
  expect(hostBox, `[${theme}] the toast host has no bounding box`).not.toBeNull();
  expect(navBox, `[${theme}] no navbar to measure against`).not.toBeNull();
  expect(
    hostBox!.y,
    `[${theme}] the toast host starts at ${hostBox!.y}px, above the navbar's bottom edge ` +
      `at ${navBox!.y + navBox!.height}px — it would sit under the sticky navbar`,
  ).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);
}

/**
 * The host's own horizontal fit — measured against the LAYOUT viewport.
 *
 * This used to compare against `documentElement.scrollWidth` instead, because reader view
 * overflowed to 464px on a 393px screen with no toast involved (#144) and a `fixed` element
 * resolves its insets against an initial containing block Chromium expands to match. The
 * toast measured 452px and looked like the offender; it was pinned correctly to a page that
 * was too wide.
 *
 * #144 fixed the page, so the two widths converge and this compares against the layout
 * viewport directly. If reader view ever overflows again, this fails — which is the point.
 */
async function expectHostWithinViewport(page: Page, theme: string): Promise<void> {
  await expect(host(page)).toBeVisible();

  // Measured INSIDE the page, not via Playwright's boundingBox. A fixed element's
  // getBoundingClientRect() and documentElement.clientWidth share one coordinate space —
  // the layout viewport — so the comparison holds regardless of how far Chromium's
  // shrink-to-fit has zoomed out or panned the visual viewport. Measuring from outside
  // mixes the two: at 360px the host reported x = -13, which says nothing about the toast
  // and everything about the page being wider than the screen.
  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="error-toast-host"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      layoutWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });

  expect(box, `[${theme}] the toast host is not in the DOM`).not.toBeNull();
  const { left, right, layoutWidth, documentWidth } = box!;

  expect(
    left,
    `[${theme}] the toast host starts at ${Math.round(left)}px, left of the layout viewport`,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    right,
    `[${theme}] the toast host extends to ${Math.round(right)}px, past the ${layoutWidth}px ` +
      `layout viewport (document ${documentWidth}px)`,
  ).toBeLessThanOrEqual(layoutWidth + 1);
}

test.describe('Error toast on mobile', () => {
  // Two themes x (a reload, a bulk failure, a view switch, a scroll, and three toast
  // transitions), twice over. Same shape and budget as the neighbouring mobile specs.
  test.setTimeout(120_000);

  let user: RegisteredUser;
  const createdEmails: string[] = [];

  test.beforeEach(async ({ request }) => {
    user = await registerOwner(request, 'error-toast-mobile');
    createdEmails.push(user.email);
  });

  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  test('an illustration failure is visible in either theme, including from the bottom of the page', async ({
    page,
  }) => {
    await installBookMocks(page, {
      status: 'draft',
      createdBy: user.id,
      pages: MIXED_PAGES,
      token: user.token,
    });

    // The per-page history fetch the reader view fires on mount. Empty is the honest answer
    // for a mocked book, and mocking it keeps a 404 from the real server out of the run.
    await page.route(`**/api/books/${BOOK_ID}/illustrations/*`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    // Failure injection — a paid Fal call becomes a 500 carrying the message the server would
    // have sent. NO PAID CALL IS MADE, AND NONE MAY BE ADDED.
    await page.route(`**/api/books/${BOOK_ID}/illustrate`, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: FAILURE_MESSAGE }),
      }),
    );

    // "Illustrate All" asks for confirmation when more than one page is unillustrated.
    // Playwright dismisses dialogs by default, which would cancel the request instead of
    // failing it.
    page.on('dialog', (dialog) => void dialog.accept());

    await seedAuth(page, user);
    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pip Goes to the Mountains');

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        // --- 1. Spread view, top of the page. The page has no overflow of its own here, so
        // this is where the document-wide scan means something: the toast must not add any.
        // The mocked cast carries no portrait_url, so `canBulkIllustrate` is false and
        // "Illustrate All" renders disabled. Taking the documented escape hatch is how a
        // real owner reaches this state too — and clicking a disabled button would have
        // timed out rather than failing with anything readable.
        await page.getByRole('button', { name: /Skip portraits/ }).click();
        await page.getByRole('button', { name: /Illustrate All/ }).click();

        await expect(host(page), `[${theme}] the failure never reached a visible surface`).toBeVisible();
        await expect(host(page).getByText(FAILURE_MESSAGE)).toBeVisible();
        await expect(host(page).getByRole('alert')).toHaveCount(1);
        await expectBelowNavbar(page, theme);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, HOST_CONTROLS, PRIMARY_TAP_MIN);

        // Dismissible. One toast in the queue, so the host unmounts with it.
        await host(page).getByRole('button', { name: 'Dismiss error' }).click();
        await expect(host(page)).toHaveCount(0);

        // --- 2. #114's repro: reader view, scrolled away from the top, failure raised by a
        // per-page control far below the header the message used to render into.
        await page.getByRole('button', { name: /reader view/i }).click();
        const regenerate = page.getByRole('button', { name: /^Regenerate$/ }).first();
        await expect(regenerate).toBeVisible();

        await page.mouse.wheel(0, 4000);
        await expect
          .poll(() => page.evaluate(() => window.scrollY), {
            message: `[${theme}] the page never scrolled, so this proves nothing about a scrolled user`,
          })
          .toBeGreaterThan(200);
        const scrolledTo = await page.evaluate(() => window.scrollY);

        await regenerate.click();

        // No scrolling back up before this assertion — that is the whole point of #114.
        await expect(
          host(page),
          `[${theme}] the failure was invisible to a user scrolled ${scrolledTo}px down the page`,
        ).toBeVisible();
        await expect(host(page).getByText(FAILURE_MESSAGE)).toBeVisible();
        expect(
          await page.evaluate(() => window.scrollY),
          `[${theme}] the page scrolled itself to show the message; the toast must come to the user`,
        ).toBeGreaterThan(200);
        await expectBelowNavbar(page, theme);
        await expectHostWithinViewport(page, theme);
        await expectTapTargets(page, HOST_CONTROLS, PRIMARY_TAP_MIN);

        // --- 3. Persist-until-dismissed does not mean persist-forever: a route change empties
        // the queue ("Couldn't restore that user." is meaningless on /cart). This has to be an
        // in-app navigation — a full page load would clear it trivially and prove nothing.
        // The sticky navbar, not the in-page "Back to My Books" link: we are 4000px down
        // the reader view and that link is at the top.
        await page.getByRole('link', { name: 'My Books', exact: true }).click();
        await expect(page).toHaveURL(/\/my-books$/);
        await expect(host(page), `[${theme}] the toast survived a route change`).toHaveCount(0);

        // forEachTheme's next pass reloads whatever URL is current, so go back.
        await page.goto(`/book/${BOOK_ID}`);
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Pip Goes to the Mountains');
      });
    });
  });
});
