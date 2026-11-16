import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE } from '../../ports';
import { registerOwner, seedAuth, deleteUsers, type RegisteredUser } from '../_editPublished';
import { forEachTheme, expectNoHorizontalOverflow, expectTapTargets } from './_helpers';

/**
 * A dead token routes to sign-in and back (#210, Task 7), under both mobile projects and in
 * both themes.
 *
 * Done-criterion #2 (ADR-009): this spec claims the CORRECTNESS half only: no horizontal
 * overflow and the 44px tap-target floor on the sign-in screen the user is bounced to, in
 * light and dark. The AESTHETIC half (does the "Your session ended" notice read as calm
 * rather than alarming) needs one human look and is the manual step in Task 4.
 *
 * Why logout stands in for expiry: the server answers an expired token and a revoked one
 * with the same 401, so the browser cannot tell them apart. Expiry by clock is pinned in
 * the server suite (Task 3). `killToken` ends the session through the real logout route.
 *
 * Spend: test 2 registers a 401 stub for `/api/generate` before anything else, so it can
 * never reach the paid route.
 */

const PASSWORD = 'pw-test-1234';
const NOTICE = 'Your session ended. Sign in to pick up where you left off.';

/** Ends the session server-side through the real logout route, and proves it is dead. */
async function killToken(request: APIRequestContext, token: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` };
  const out = await request.post(`${API_BASE}/api/auth/logout`, { headers });
  expect(out.ok()).toBeTruthy();
  const me = await request.get(`${API_BASE}/api/auth/me`, { headers });
  expect(me.status()).toBe(401);
}

/** A brand-new user has no books, so the page renders its empty state instead of the "My Books" h1. */
const myBooksContent = (page: Page) => page.getByRole('heading', { name: /^(My Books|No books yet)$/ });

async function signInAgain(page: Page, user: RegisteredUser): Promise<void> {
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

test.describe('Session expiry on mobile', () => {
  test.setTimeout(120_000);

  const createdEmails: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  test('a real 401 on My Books routes to sign-in and back', async ({ page, request }) => {
    await page.goto('/');
    await forEachTheme(page, async () => {
      // A fresh user per theme: the previous run's sign-in made its own token live again.
      const user = await registerOwner(request, 'session-expiry');
      createdEmails.push(user.email);
      await seedAuth(page, user);
      // Start on Browse and let its own authed calls (the cart) finish BEFORE the token
      // dies. Otherwise whichever authed call lands first after the kill gets the 401, and
      // the redirect can beat the My Books click (the flake found on #234).
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const myBooksLink = page.getByRole('link', { name: 'My Books' });
      await expect(myBooksLink).toBeVisible();

      await killToken(request, user.token);

      // Client-side navigation only: a reload takes the mount-check path, which does not redirect.
      await myBooksLink.click();

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('status').filter({ hasText: NOTICE })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTapTargets(page, 'form button[type="submit"], form input', 44);

      await signInAgain(page, user);
      await expect(page).toHaveURL(/\/my-books$/);
      await expect(myBooksContent(page)).toBeVisible();
    });
  });

  test('the Create-a-Book wizard survives the bounce', async ({ page, request }) => {
    // Before anything else, so this test cannot reach the paid route.
    await page.route('**/api/generate', (route) =>
      route.fulfill({ status: 401, json: { error: 'Not authenticated' } }),
    );

    await page.goto('/');
    await forEachTheme(page, async () => {
      const user = await registerOwner(request, 'session-expiry-wizard');
      createdEmails.push(user.email);
      await seedAuth(page, user);
      // The draft lives in sessionStorage and outlives the first theme's run; start step 1 again.
      await page.evaluate(() => sessionStorage.clear());
      await page.goto('/create');

      await page.getByRole('button', { name: /Adventure/ }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByPlaceholder(/^Name/).first().fill('Luna');
      await page.getByRole('button', { name: 'Ages 4-7' }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { name: 'Any Special Requests?' })).toBeVisible();

      await page.getByRole('button', { name: /Generate My Story/ }).click();

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('status').filter({ hasText: NOTICE })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTapTargets(page, 'form button[type="submit"], form input', 44);

      await signInAgain(page, user);
      await expect(page).toHaveURL(/\/create$/);
      await expect(page.getByRole('heading', { name: 'Any Special Requests?' })).toBeVisible();
      await expect(page.getByText('adventure', { exact: false }).first()).toBeVisible();
      await expect(page.getByText('Luna').first()).toBeVisible();
      await expect(page.getByText('4-7').first()).toBeVisible();
    });
  });
});
