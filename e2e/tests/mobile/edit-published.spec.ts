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
 * "Withdraw to edit" at mobile width, under both mobile viewport projects and in both themes
 * (#20, Task 8).
 *
 * **This spec is the mechanical discharge of CLAUDE.md done-criterion #2 for this feature**
 * (ADR-009): it runs the author's loop in both themes at 393px and 360px, asserting no
 * horizontal overflow and the 44px tap-target floor on every new control. That covers the
 * *correctness* half of "verified in light and dark mode". The *aesthetic* half — whether the
 * withdrawal copy reads as reassuring rather than alarming, and whether the out-of-catalog
 * banner feels like a state rather than an error — needs one human look, and this spec does
 * not claim it. Task 7's desktop spec claims neither half: it runs one theme at desktop width.
 *
 * Setup is Task 7's, imported rather than re-derived: real registered auth, a fully
 * route-mocked book. The reasoning, and what it costs, is in `../_editPublished.ts`.
 */

/** Every publish-state assertion is scoped to `PublishStateBar`'s `<section aria-label>`. */
const publishStateBar = (page: Page) => page.getByRole('region', { name: 'Publish state' });

/**
 * The explicit tap-target list, never "all buttons" (ADR-009). Scoping to the component's own
 * testid enumerates exactly the controls this feature adds — the withdraw trigger, both
 * confirm actions, and both Cancels — and nothing else on a page that also carries the
 * navbar's 24px icon chrome and BookSpread's own controls.
 */
const BAR_CONTROLS = '[data-testid="publish-state-bar"] button';

/**
 * `UpdateToast` (`fixed inset-x-3 bottom-3 z-50`) is the app's only bottom-fixed surface —
 * the ADR-011 invariant that `mobile/narration.spec.ts` also pins. A publish-state bar that
 * went sticky would sit in the same ~60px of a phone screen as the toast, an occlusion bug no
 * overflow check can see. Deleting this assertion is how that question gets re-opened.
 */
async function expectNotFixed(page: Page, theme: string): Promise<void> {
  const position = await publishStateBar(page).evaluate((el) => getComputedStyle(el).position);
  expect(
    position,
    `[${theme}] the publish-state bar is fixed; UpdateToast must remain the only fixed surface`,
  ).not.toBe('fixed');
}

test.describe('Edit published books on mobile', () => {
  // Two themes x (a reload, a confirm expansion, and a status transition), twice over. The
  // narration spec uses 120s for a comparable shape.
  test.setTimeout(120_000);

  let user: RegisteredUser;
  const createdEmails: string[] = [];

  test.beforeEach(async ({ request }) => {
    user = await registerOwner(request, 'edit-published-mobile');
    createdEmails.push(user.email);
  });

  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  test('published: the bar, its confirm, and the withdrawal fit the viewport in either theme', async ({
    page,
  }) => {
    const mocks = await installBookMocks(page, {
      status: 'published',
      createdBy: user.id,
      pages: MIXED_PAGES,
      token: user.token,
    });
    await seedAuth(page, user);

    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pip Goes to the Mountains');

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        const bar = publishStateBar(page);

        // --- In the catalog, confirm collapsed.
        await expect(bar.getByText('In the catalog', { exact: true })).toBeVisible();
        await expect(
          bar.getByText('Readers can find and buy this book. Editing it means taking it out first.'),
        ).toBeVisible();
        await expect(bar, `[${theme}] more than one publish-state bar is mounted`).toHaveCount(1);
        await expectNotFixed(page, theme);
        await expect(page.getByTestId('withdraw-confirm')).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, BAR_CONTROLS, PRIMARY_TAP_MIN);

        // --- Confirm expanded. The amber panel carries the longest copy in the feature and
        // is the likely offender at 360px.
        await bar.getByRole('button', { name: 'Edit this book' }).click();
        await expect(page.getByTestId('withdraw-confirm')).toBeVisible();
        await expect(bar.getByText(/Editing takes/)).toContainText(
          'out of the catalog while you work',
        );
        await expect(bar.getByText(/keeps their receipt/)).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Take it out and edit' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, BAR_CONTROLS, PRIMARY_TAP_MIN);

        // --- Withdraw. Every draft-only editing surface mounts at once, which is the widest
        // this page ever gets — so the overflow scan below is the one that matters most.
        await bar.getByRole('button', { name: 'Take it out and edit' }).click();
        await expect(bar.getByText('Out of the catalog while you edit')).toBeVisible();
        expect(mocks.hits.unpublish, `[${theme}] expected exactly one unpublish request`).toBe(1);
        expect(mocks.status()).toBe('draft');
        await expect(bar.getByText('3 pages · 2 without an illustration')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Revise Your Story' })).toBeVisible();
        await expectNotFixed(page, theme);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, BAR_CONTROLS, PRIMARY_TAP_MIN);

        // The mock keeps its own `status`, so without this the next theme's reload would
        // load an already-withdrawn book and the pass would assert nothing.
        mocks.reset();
      });
    });
  });

  test('draft: the banner and the unillustrated confirm fit the viewport in either theme', async ({
    page,
  }) => {
    const mocks = await installBookMocks(page, {
      status: 'draft',
      createdBy: user.id,
      pages: MIXED_PAGES,
      token: user.token,
    });
    await seedAuth(page, user);

    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pip Goes to the Mountains');

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        const bar = publishStateBar(page);

        // --- Out of the catalog, confirm collapsed.
        await expect(bar.getByText('Out of the catalog while you edit')).toBeVisible();
        await expect(bar.getByText('3 pages · 2 without an illustration')).toBeVisible();
        await expect(bar, `[${theme}] more than one publish-state bar is mounted`).toHaveCount(1);
        await expectNotFixed(page, theme);
        await expect(page.getByTestId('publish-confirm')).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, BAR_CONTROLS, PRIMARY_TAP_MIN);

        // --- Confirm expanded. Nothing is sent until it is answered, at mobile width too.
        await bar.getByRole('button', { name: 'Publish changes' }).click();
        await expect(page.getByTestId('publish-confirm')).toBeVisible();
        await expect(
          bar.getByText('2 of 3 pages have no illustration yet. Publish anyway?'),
        ).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Publish anyway' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Cancel' })).toBeVisible();
        expect(mocks.hits.publish, `[${theme}] the confirm leaked a publish request`).toBe(0);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, BAR_CONTROLS, PRIMARY_TAP_MIN);

        // --- Cutover. Back to the published bar, still within the viewport.
        await bar.getByRole('button', { name: 'Publish anyway' }).click();
        await expect(bar.getByText('In the catalog', { exact: true })).toBeVisible();
        expect(mocks.hits.publish, `[${theme}] expected exactly one publish request`).toBe(1);
        expect(mocks.status()).toBe('published');
        await expectNotFixed(page, theme);
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, BAR_CONTROLS, PRIMARY_TAP_MIN);

        mocks.reset();
      });
    });
  });
});
