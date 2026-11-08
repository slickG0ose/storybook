import { test, expect, type Page } from '@playwright/test';
import { deleteUsers, registerOwner, seedAuth, type RegisteredUser } from './_editPublished';
import {
  SEEDED_BOOK_ID,
  SEEDED_BOOK_PATH,
  adminFeedbackTab,
  feedbackDialog,
  feedbackOverlay,
  feedbackTrigger,
  installAdminMocks,
  openFeedback,
} from './_feedback';
import { expectNoHorizontalOverflow, forEachTheme } from './mobile/_helpers';

/**
 * Tester feedback widget, desktop (`chromium`, 1280x720). #157, spec:
 * `.code-captain/specs/tester-feedback-widget/spec.md`, Task 8.
 *
 * Done-criterion #2 (ADR-009): this spec claims the CORRECTNESS half only — both themes,
 * no horizontal overflow, the overlay really covers the viewport. Whether it looks right
 * is still a human call.
 *
 * The tester flows run against the real server. The admin flow is route-mocked; see the
 * docblock in `_feedback.ts` for why.
 */

/** Throws an uncaught error on the page and resolves once it has fired. */
async function throwWindowError(page: Page, message: string): Promise<void> {
  await page.evaluate(
    msg =>
      new Promise<void>(resolve => {
        setTimeout(() => {
          throw new Error(msg);
        });
        // Queued after the throwing timer, so the window `error` event has run by now.
        setTimeout(resolve, 0);
      }),
    message,
  );
}

test.describe('Feedback as a signed-in tester', () => {
  const createdEmails: string[] = [];
  let user: RegisteredUser;

  test.beforeEach(async ({ page, request }) => {
    user = await registerOwner(request, 'feedback-e2e');
    createdEmails.push(user.email);
    await seedAuth(page, user);
  });

  // Cleanup cascades the Feedback rows (onDelete: Cascade on Feedback.user).
  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  test('submits from a book page with the right context, in both themes', async ({ page }) => {
    await page.goto(SEEDED_BOOK_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

    await forEachTheme(page, async theme => {
      await test.step(`${theme} mode`, async () => {
        await expect(feedbackTrigger(page)).toBeVisible();

        // An uncaught error before sending: the report must carry it as recent_errors.
        const boom = `e2e-boom-${theme}`;
        await throwWindowError(page, boom);

        await openFeedback(page);
        // Desktop pass of the open dialog (1280px).
        await expectNoHorizontalOverflow(page);

        await expect(page.getByRole('radio', { name: 'Bug' })).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('radio', { name: 'Idea' }).click();
        await expect(page.getByRole('radio', { name: 'Idea' })).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('textbox', { name: 'Your feedback' }).fill(`A bookmark button, please (${theme}).`);

        const requestPromise = page.waitForRequest(
          req => req.url().endsWith('/api/feedback') && req.method() === 'POST',
        );
        const responsePromise = page.waitForResponse(
          res => res.url().endsWith('/api/feedback') && res.request().method() === 'POST',
        );
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        const req = await requestPromise;
        const res = await responsePromise;

        const body = req.postDataJSON() as Record<string, unknown>;
        const sessionId = await page.evaluate(() => localStorage.getItem('storybook-session'));
        const viewport = page.viewportSize();

        expect(req.headers()['authorization']).toBe(`Bearer ${user.token}`);
        expect(body).toMatchObject({
          category: 'idea',
          message: `A bookmark button, please (${theme}).`,
          book_id: SEEDED_BOOK_ID,
          theme,
          session_id: sessionId,
          viewport_width: viewport!.width,
          viewport_height: viewport!.height,
        });
        expect(sessionId, 'the cart session UUID should exist before the report is sent').toBeTruthy();
        expect(String(body.route)).toMatch(/^\/book\//);
        expect(body, 'identity comes from the token, never the body').not.toHaveProperty('user_id');
        expect(body.recent_errors, 'the window error thrown before sending is missing').toEqual(
          expect.arrayContaining([expect.stringContaining(boom)]),
        );

        // The real server accepted it — the 201 is the stored row.
        expect(res.status()).toBe(201);
        expect(await res.json()).toMatchObject({
          id: expect.any(String),
          status: 'new',
          created_at: expect.any(String),
        });

        await expect(page.getByRole('status').filter({ hasText: "Thanks — that's been sent." })).toBeVisible();
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(feedbackDialog(page)).toHaveCount(0);
      });
    });
  });

  test('the dialog covers the real theater view, in both themes', async ({ page }) => {
    await page.goto(`${SEEDED_BOOK_PATH}?theater=1`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

    await forEachTheme(page, async theme => {
      await test.step(`${theme} mode`, async () => {
        // Proves the page is genuinely in theater mode, not just carrying the query.
        await expect(page.getByRole('button', { name: 'Exit theater mode' })).toHaveAttribute('aria-pressed', 'true');

        await openFeedback(page);

        const viewport = page.viewportSize()!;
        const box = await feedbackOverlay(page).boundingBox();
        expect(box, `[${theme}] the overlay has no box`).not.toBeNull();
        expect(box!.x).toBe(0);
        expect(box!.y).toBe(0);
        expect(box!.width).toBe(viewport.width);
        expect(box!.height).toBe(viewport.height);

        // Covers means on top: the sticky Navbar (also z-50) and the widened reader frame
        // must both sit under the overlay, not poke through it.
        const onTop = await page.evaluate(
          ([w, h]) => {
            const overlay = document.querySelector('[role="dialog"]')?.parentElement;
            const points: [number, number][] = [
              [5, 5], // Navbar, top-left
              [w - 5, 30], // Navbar, top-right
              [w / 2, h / 2], // reader frame, mid-viewport
              [5, h - 5],
              [w - 5, h - 5],
            ];
            return points.map(([x, y]) => {
              const hit = document.elementFromPoint(x, y);
              return { x, y, covered: !!overlay && !!hit && overlay.contains(hit) };
            });
          },
          [viewport.width, viewport.height] as const,
        );
        for (const p of onTop) {
          expect(p.covered, `[${theme}] something renders above the overlay at (${p.x}, ${p.y})`).toBe(true);
        }

        await expectNoHorizontalOverflow(page);

        await page.keyboard.press('Escape');
        await expect(feedbackDialog(page)).toHaveCount(0);
        await expect(feedbackTrigger(page)).toBeFocused();
      });
    });
  });
});

test.describe('Feedback signed out', () => {
  test('shows no Send feedback button', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    // Auth has resolved once Sign In renders; only then is the absence meaningful.
    await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible();
    await expect(feedbackTrigger(page)).toHaveCount(0);
  });
});

test.describe('Feedback as admin (mocked)', () => {
  const createdEmails: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  test('lists reports, changes a status, and follows the route link, in both themes', async ({ page, request }) => {
    const user = await registerOwner(request, 'feedback-admin-e2e');
    createdEmails.push(user.email);
    const mocks = await installAdminMocks(page, user);
    await seedAuth(page, user);

    const listRequests: string[] = [];
    page.on('request', req => {
      if (req.method() === 'GET' && /\/api\/admin\/feedback(\?|$)/.test(req.url())) listRequests.push(req.url());
    });

    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();

    await forEachTheme(page, async theme => {
      await test.step(`${theme} mode`, async () => {
        mocks.reset();
        await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
        await adminFeedbackTab(page).click();
        await expect(adminFeedbackTab(page)).toHaveAttribute('aria-pressed', 'true');
        expect(listRequests.at(-1), 'the Feedback tab should default to the New filter').toMatch(/\?status=new$/);

        const cards = page.getByTestId('feedback-card');
        await expect(cards).toHaveCount(2);

        const first = cards.nth(0);
        await expect(first).toContainText('grandma.reads.aloud.every.night@example.com');
        await expect(first).toContainText('Bug');
        await expect(first).toContainText('The page turned twice when I tapped once.');
        await expect(first.getByRole('link', { name: `${SEEDED_BOOK_PATH}?theater=1` })).toHaveAttribute(
          'href',
          `${SEEDED_BOOK_PATH}?theater=1`,
        );
        await expect(first).toContainText('1 recent error');

        const second = cards.nth(1);
        await expect(second).toContainText('uncle.ben@example.com');
        await expect(second).toContainText('Idea');
        await expect(second).toContainText('Could the cart remember gift wrap?');
        await expect(second.getByRole('link', { name: '/cart' })).toHaveAttribute('href', '/cart');

        const select = page.getByRole('combobox', {
          name: 'Status for feedback from grandma.reads.aloud.every.night@example.com',
        });
        await select.selectOption('triaged');
        await expect.poll(() => mocks.patches.length).toBe(1);
        expect(mocks.patches[0]).toEqual({ id: 'fb-e2e-1', body: { status: 'triaged' } });
        await expect(select).toHaveValue('triaged');
        await expect(select).toBeEnabled();

        await first.getByRole('link', { name: `${SEEDED_BOOK_PATH}?theater=1` }).click();
        await expect(page).toHaveURL(new RegExp(`${SEEDED_BOOK_PATH}\\?theater=1$`));
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

        // Back to /admin, so forEachTheme's reload lands there for the next pass.
        await page.goto('/admin');
      });
    });
  });
});
