import { test, expect } from '@playwright/test';

// Admin page (OPS.2) e2e — fully route-mocked for admin endpoints.
//
// Auth itself is real: we register a fresh regular user against the live
// server (cheap, no AI) so we have a valid bearer token, then route-mock
// /api/auth/me to override the role to 'admin' for test 1, and leave it
// alone for test 2 (where the regular 'user' role flows through and the
// guard should redirect away from /admin).

interface RegisterResponse {
  id: string;
  email: string;
  name: string;
  token: string;
  role?: 'user' | 'admin';
}

const ACTIVE_BOOK_ID = 'admin-book-active-1';
const DELETED_BOOK_ID = 'admin-book-deleted-1';
const DELETED_BOOK_TITLE = 'A Forgotten Tale';
const ACTIVE_BOOK_TITLE = 'The Brave Otter';
const ORPHAN_PATH = '/illustrations/abc123-orphan-dir';
const DELETED_USER_EMAIL = 'old-account@example.com';

test.describe('Admin page', () => {
  let restoreHits = 0;
  let user: RegisterResponse;
  // Track every email we registered against the live server so afterAll can
  // delete them. Otherwise these accumulate in dev.db across runs with
  // reuseExistingServer.
  const createdEmails: string[] = [];

  test.beforeEach(async ({ request }) => {
    restoreHits = 0;

    // Register a fresh regular user against the real server. Unique email
    // per run so concurrent test workers don't collide.
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `admin-spec-${suffix}@example.com`;
    const res = await request.post('http://localhost:3001/api/auth/register', {
      data: { email, name: 'Admin Spec Tester', password: 'pw-test-1234' },
    });
    expect(res.ok()).toBeTruthy();
    user = (await res.json()) as RegisterResponse;
    createdEmails.push(email);
  });

  test.afterAll(async ({ request }) => {
    // Clean up every user we registered against the live server so dev.db
    // doesn't accumulate timestamped @example.com accounts across runs.
    for (const email of createdEmails) {
      await request.delete('http://localhost:3001/api/_test/user-by-email', {
        data: { email },
        headers: { 'x-test-secret': 'dev-test-secret' },
      });
    }
    createdEmails.length = 0;
  });

  test('admin can view the admin page and restore a soft-deleted book', async ({ page }) => {
    // The real registration returns role: 'user'. Override /api/auth/me so
    // the AuthContext hydrates this session as an admin and the page guard
    // lets us through.
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'admin',
        }),
      });
    });

    const deletedUserAt = new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString();
    const deletedBookAt = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();

    await page.route('**/api/admin/users', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body = [
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'admin',
          created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
          deleted_at: null,
        },
        {
          id: 'deleted-user-1',
          email: DELETED_USER_EMAIL,
          name: 'Old Account',
          role: 'user',
          created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
          deleted_at: deletedUserAt,
        },
      ];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    const baseBook = {
      theme: 'fantasy',
      age_range: '4-7',
      cover_emoji: '\u{1F43E}',
      cover_color: '#a78bfa',
      cover_url: null,
      price: 19.99,
      is_featured: 0,
      is_user_created: 1,
      status: 'published',
      version: 1,
      characters: [],
      style_descriptor: null,
      style_reference_url: null,
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    };

    await page.route('**/api/admin/books', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body = [
        {
          id: ACTIVE_BOOK_ID,
          title: ACTIVE_BOOK_TITLE,
          author: 'Test Author',
          description: 'A brave otter goes on adventures.',
          ...baseBook,
          created_by: null,
          creator: null,
          deleted_at: null,
        },
        {
          id: DELETED_BOOK_ID,
          title: DELETED_BOOK_TITLE,
          author: 'Test Author',
          description: 'A forgotten tale that was soft-deleted.',
          ...baseBook,
          created_by: 'some-creator-id',
          creator: { email: 'creator@example.com', name: 'Some Creator' },
          deleted_at: deletedBookAt,
        },
      ];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.route('**/api/admin/orphan-illustrations', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body = [
        { path: ORPHAN_PATH, book_exists: false, soft_deleted: false },
      ];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.route(`**/api/admin/books/${DELETED_BOOK_ID}/restore`, async route => {
      restoreHits += 1;
      const auth = route.request().headers()['authorization'];
      expect(auth).toBe(`Bearer ${user.token}`);
      expect(route.request().method()).toBe('PUT');
      const restored = {
        id: DELETED_BOOK_ID,
        title: DELETED_BOOK_TITLE,
        author: 'Test Author',
        description: 'A forgotten tale that was soft-deleted.',
        ...baseBook,
        created_by: 'some-creator-id',
        creator: { email: 'creator@example.com', name: 'Some Creator' },
        deleted_at: null,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(restored) });
    });

    // Seed localStorage on the right origin, then go to /admin.
    await page.goto('/');
    await page.evaluate(({ id, email, name, token }) => {
      localStorage.setItem(
        'storybook-auth',
        JSON.stringify({ id, email, name, token, role: 'admin' }),
      );
    }, { id: user.id, email: user.email, name: user.name, token: user.token });

    await page.goto('/admin');

    // Admin header is visible — guard let us through.
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();

    // Users tab is the default. Both users render; the soft-deleted one
    // shows a "Deleted" badge.
    await expect(page.getByRole('button', { name: /^Users \(2\)$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(user.email)).toBeVisible();
    await expect(page.getByText(DELETED_USER_EMAIL)).toBeVisible();
    await expect(page.getByText(/^Deleted /)).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    // Switch to Books tab.
    await page.getByRole('button', { name: /^Books \(2\)$/ }).click();
    await expect(page.getByRole('button', { name: /^Books \(2\)$/ })).toHaveAttribute('aria-pressed', 'true');

    // Both books render.
    await expect(page.getByRole('link', { name: ACTIVE_BOOK_TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: DELETED_BOOK_TITLE })).toBeVisible();

    // The restore button is targeted by its accessible name and exists only
    // for the soft-deleted book.
    const restoreBtn = page.getByRole('button', { name: `Restore book ${DELETED_BOOK_TITLE}` });
    await expect(restoreBtn).toBeVisible();
    await expect(page.getByRole('button', { name: `Restore book ${ACTIVE_BOOK_TITLE}` })).toHaveCount(0);

    // Accept the confirm() dialog.
    let dialogMessage = '';
    page.once('dialog', dialog => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    await restoreBtn.click();

    await expect.poll(() => dialogMessage.toLowerCase()).toContain('restore');
    await expect.poll(() => restoreHits).toBe(1);

    // After restore, the row updates: no "Restore book" button for that book,
    // and only one "Deleted" badge remains visible page-wide (the deleted
    // user on the Users tab is unmounted, so really zero — but be lenient
    // since we're scoped to the Books tab now: the restored book's row
    // should no longer have a Restore button).
    await expect(page.getByRole('button', { name: `Restore book ${DELETED_BOOK_TITLE}` })).toHaveCount(0);

    // Orphans tab shows the orphan path.
    await page.getByRole('button', { name: /^Orphans \(1\)$/ }).click();
    await expect(page.getByRole('button', { name: /^Orphans \(1\)$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(ORPHAN_PATH)).toBeVisible();
    await expect(page.getByText('Missing', { exact: true })).toBeVisible();
  });

  test('non-admin user is redirected away from /admin and the Admin link is hidden', async ({ page }) => {
    // Mock /api/auth/me to return the regular role explicitly so we don't
    // depend on the real DB response shape. The guard should redirect to /.
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'user',
        }),
      });
    });

    // Seed localStorage and navigate to /admin.
    await page.goto('/');
    await page.evaluate(({ id, email, name, token }) => {
      localStorage.setItem(
        'storybook-auth',
        JSON.stringify({ id, email, name, token, role: 'user' }),
      );
    }, { id: user.id, email: user.email, name: user.name, token: user.token });

    await page.goto('/admin');

    // Guard redirects to /. Wait for the URL to flip and the Admin header
    // to NOT be present.
    await expect(page).toHaveURL('http://localhost:5173/');
    await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toHaveCount(0);

    // And the navbar must not show the Admin link for non-admins.
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  });
});
