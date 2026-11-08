import { test, expect } from '@playwright/test';
import { deleteUsers, registerOwner, seedAuth } from '../_editPublished';
import {
  SEEDED_BOOK_PATH,
  adminFeedbackTab,
  feedbackDialog,
  feedbackTrigger,
  installAdminMocks,
  openFeedback,
} from '../_feedback';
import { NAV_TAP_MIN, PRIMARY_TAP_MIN, expectNoHorizontalOverflow, expectTapTargets, forEachTheme } from './_helpers';

/**
 * Tester feedback widget at mobile width (`mobile-pixel` 393px, `mobile-small` 360px), in
 * both themes. #157, spec: `.code-captain/specs/tester-feedback-widget/spec.md`, Task 8.
 *
 * Done-criterion #2 (ADR-009): this spec claims the CORRECTNESS half only — no horizontal
 * overflow with the dialog closed or open, tap-target floors, and the trigger staying out
 * of the fixed-surface budget. The aesthetic half still needs a human.
 */

const DIALOG_CONTROLS = '[role="dialog"] button, [role="dialog"] textarea';

test.describe('Feedback widget on mobile, signed-in tester', () => {
  const createdEmails: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  for (const path of ['/', SEEDED_BOOK_PATH]) {
    test(`no overflow and full-size targets on ${path}, dialog closed and open`, async ({ page, request }) => {
      const user = await registerOwner(request, 'feedback-mobile-e2e');
      createdEmails.push(user.email);
      await seedAuth(page, user);
      await page.goto(path);

      await forEachTheme(page, async theme => {
        await test.step(`${theme} mode`, async () => {
          const trigger = feedbackTrigger(page);
          await expect(trigger).toBeVisible();
          if (path === SEEDED_BOOK_PATH) {
            await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');
          }

          await expectNoHorizontalOverflow(page);
          await expectTapTargets(page, '[aria-label="Send feedback"]', NAV_TAP_MIN);
          const position = await trigger.evaluate(el => getComputedStyle(el).position);
          expect(
            position,
            `[${theme}] the Feedback trigger is position: fixed — ADR-017 allows exactly two fixed ` +
              'surfaces (ErrorToastHost top, UpdateToast bottom); the trigger must stay in the sticky Navbar',
          ).not.toBe('fixed');

          await openFeedback(page);
          await expectNoHorizontalOverflow(page);
          await expectTapTargets(page, DIALOG_CONTROLS, PRIMARY_TAP_MIN);

          await page.keyboard.press('Escape');
          await expect(feedbackDialog(page)).toHaveCount(0);
        });
      });
    });
  }
});

test.describe('Feedback widget on mobile, mocked admin', () => {
  const createdEmails: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  test('the 9-control Navbar row and the Feedback tab fit, in both themes', async ({ page, request }) => {
    const user = await registerOwner(request, 'feedback-mobile-admin-e2e');
    createdEmails.push(user.email);
    await installAdminMocks(page, user);
    await seedAuth(page, user);

    // The densest Navbar row: Admin link and Feedback trigger both present.
    await page.goto('/');
    await forEachTheme(page, async theme => {
      await test.step(`${theme} mode, Navbar`, async () => {
        await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
        await expect(feedbackTrigger(page)).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    });

    await page.goto('/admin');
    await forEachTheme(page, async theme => {
      await test.step(`${theme} mode, Feedback tab`, async () => {
        await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
        await adminFeedbackTab(page).click();
        await expect(adminFeedbackTab(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('feedback-card')).toHaveCount(2);

        // The six admin pills wrap rather than scroll (Task 7); with the Feedback tab open
        // and its long-email / long-UA cards rendered, nothing may push past the viewport.
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, 'select[aria-label^="Status for feedback from"]', PRIMARY_TAP_MIN);
      });
    });
  });
});
