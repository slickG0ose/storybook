import { test, expect } from '@playwright/test';
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
 * The illustration action row on `/book/:id` at mobile width (#124).
 *
 * The row holds up to four controls at once — "Illustrate All (~$0.08)", the "Approve cast
 * to illustrate with consistent characters." notice with its "Skip portraits" escape hatch,
 * and "Download PDF" — inside a single `flex items-center gap-3` with no wrap. At 393px the
 * last control was pushed past the container edge and clipped.
 *
 * This state was not reachable by any existing mobile spec: it needs a signed-in **owner**
 * viewing a **draft** whose cast has **no portraits yet** and whose pages are **not all
 * illustrated**. `mobile/edit-published.spec.ts` covers the published side of the same page
 * and never sees this row.
 *
 * Auth is real; the book is route-mocked. Same trade as `_editPublished.ts` documents, and
 * for the same reason — `POST /:id/illustrate` is a paid image call.
 */
test.describe('Illustration actions on mobile', () => {
  const created: string[] = [];
  let owner: RegisteredUser;

  test.beforeEach(async ({ page, request }) => {
    owner = await registerOwner(request, 'illus-actions-mobile');
    created.push(owner.email);
    await seedAuth(page, owner);
    await installBookMocks(page, {
      status: 'draft',
      createdBy: owner.id,
      // Characters carry no portrait_url, so `castApproved` is false and the full
      // four-control row renders. Pages 2-3 unillustrated, so "Illustrate All" is live.
      pages: MIXED_PAGES,
      token: owner.token,
    });
    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByRole('button', { name: /Illustrate All/ })).toBeVisible();
  });

  test.afterEach(async ({ request }) => {
    await deleteUsers(request, created);
  });

  test('the action row fits the viewport in both themes', async ({ page }) => {
    await forEachTheme(page, async () => {
      await expect(page.getByRole('button', { name: /Illustrate All/ })).toBeVisible();

      // The whole point of #124: nothing in this row may push the document wider than the
      // viewport. `_helpers` names the widest offenders on failure.
      await expectNoHorizontalOverflow(page);
    });
  });

  test('every control in the row is fully on screen, not clipped at the edge', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      const viewport = page.viewportSize()!;

      // Overflow alone would not have caught the reported symptom. A child can be clipped
      // by an ancestor's bounds while `documentElement.scrollWidth` stays put, which is
      // exactly what "Download PDF gets clipped at the screen edge" describes. Assert on
      // each control's own right edge.
      for (const name of [/Illustrate All/, /Skip portraits/, /Download PDF/]) {
        const control = page.getByRole('button', { name });
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        expect(
          Math.round(box.x + box.width),
          `in ${theme} mode "${name.source}" extends to ${Math.round(box.x + box.width)}px, ` +
            `past the ${viewport.width}px viewport — it is clipped at the edge`,
        ).toBeLessThanOrEqual(viewport.width);
        expect(Math.round(box.x), `"${name.source}" starts off the left edge in ${theme} mode`).toBeGreaterThanOrEqual(0);
      }
    });
  });

  test('the row’s controls are tappable', async ({ page }) => {
    await forEachTheme(page, async () => {
      await expect(page.getByRole('button', { name: /Illustrate All/ })).toBeVisible();

      // Money-path adjacent — "Illustrate All" spends real money and "Skip portraits"
      // is the gate in front of it — so the 44px HIG bar, not the 24px nav bar.
      await expectTapTargets(
        page,
        'button:has-text("Illustrate All"), button:has-text("Skip portraits"), button[aria-label="Download PDF"]',
        PRIMARY_TAP_MIN,
      );
    });
  });

  /**
   * #161. Separate from the row test above because it measures a different control in a
   * different container: the cast panel is denser than the action row, so a regression in
   * one would not show up in the other.
   *
   * The selector matches on `aria-label` rather than visible text on purpose. The label is
   * `Generate portrait for Pip` / `Regenerate portrait for Pip` regardless of state, while
   * the visible text swaps between `Generate portrait ($0.04)` and `Regenerate ($0.04)`
   * depending on whether the character has a `portrait_url`. A text selector here would
   * silently stop matching the moment a fixture gave Pip a portrait — which is exactly the
   * trap #161 flagged in `reader-view.spec.ts`, and there is no reason to rebuild it here.
   */
  test('the cast-panel portrait button is tappable', async ({ page }) => {
    await forEachTheme(page, async () => {
      const portrait = page.getByRole('button', { name: /portrait for Pip/ });
      await expect(portrait).toBeVisible();

      // Money path, not chrome: this button spends PER_IMAGE_COST_USD per press and
      // prints the price in its own label, so it takes the 44px floor like the row above.
      await expectTapTargets(page, 'button[aria-label*="portrait for"]', PRIMARY_TAP_MIN);
    });
  });

  test('a long failure message wraps instead of widening the row', async ({ page }) => {
    // Stated precisely, because it is easy to over-claim: this does NOT prove the
    // flex-wrap fix — I checked, and the message wraps either way, because a text span's
    // min-content width is its longest word. What it does guard is the next person giving
    // this error a `whitespace-nowrap` or a fixed width, which would push the row wide
    // with no other test noticing. The clipped-edge test above is the one that pins #124.
    //
    // The string is the real one from the #114 report rather than a synthetic long word,
    // so the assertion stays honest about the length actually seen in production.
    const REAL_FAILURE = 'Failed to generate illustrations. Fal image request timed out after 120s';

    await page.route(`**/api/books/${BOOK_ID}/illustrate`, async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: REAL_FAILURE }),
      });
    });

    // "Illustrate All" confirms before spending, and Playwright dismisses dialogs by
    // default — which would cancel the click and pass this test vacuously.
    page.on('dialog', (dialog) => void dialog.accept());

    await forEachTheme(page, async (theme) => {
      await page.getByRole('button', { name: /Skip portraits/ }).click();
      await page.getByRole('button', { name: /Illustrate All/ }).click();
      await expect(page.getByText(REAL_FAILURE), `the failure never rendered in ${theme} mode`).toBeVisible();

      await expectNoHorizontalOverflow(page);
    });
  });
});
