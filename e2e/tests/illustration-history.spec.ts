import { test, expect } from '@playwright/test';

// Illustration history + revert (T1.4) e2e — fully route-mocked.
//
// The real illustrate / revert flow runs through the image-AI provider, which
// is expensive and flaky. We route-mock the three relevant /api/books
// endpoints so this spec is deterministic. Auth itself is real: we register a
// fresh user against the live server (cheap, no AI) and seed localStorage
// with the returned token, so /api/auth/me succeeds and the AuthContext
// hydrates normally on mount.

const BOOK_ID = 'test-draft-1';

const V1_URL = '/uploads/illustrations/test-draft-1-p1-v1.png';
const V2_URL = '/uploads/illustrations/test-draft-1-p1-v2.png';
const V3_URL = '/uploads/illustrations/test-draft-1-p1-v3.png';
const V1_FEEDBACK = 'make it more vibrant';

const PAGES = [
  {
    id: 1,
    book_id: BOOK_ID,
    page_number: 1,
    text: 'Once upon a time there was a tiny dragon.',
    illustration_description: 'A tiny dragon in a sunlit meadow.',
    illustration_url: V3_URL,
  },
  {
    id: 2,
    book_id: BOOK_ID,
    page_number: 2,
    text: 'The dragon loved collecting smooth river stones.',
    illustration_description: 'Dragon at a riverbank picking up stones.',
    illustration_url: null,
  },
  {
    id: 3,
    book_id: BOOK_ID,
    page_number: 3,
    text: 'One day the dragon found a stone that hummed a song.',
    illustration_description: 'Dragon holding a glowing stone, wide-eyed.',
    illustration_url: null,
  },
];

interface RegisterResponse {
  id: string;
  email: string;
  name: string;
  token: string;
}

test.describe('Illustration history — revert prior version', () => {
  let illustrationsHits = 0;
  let revertHits = 0;
  let lastRevertBody: { url?: string } = {};
  let user: RegisterResponse;
  let currentIllustrationUrl = V3_URL;
  // Track every email we registered against the live server so afterAll can
  // delete them. With playwright's reuseExistingServer in dev, otherwise these
  // would accumulate in dev.db across runs.
  const createdEmails: string[] = [];

  test.beforeEach(async ({ page, request }) => {
    illustrationsHits = 0;
    revertHits = 0;
    lastRevertBody = {};
    currentIllustrationUrl = V3_URL;

    // Register a fresh user against the real server. Unique email per run.
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `illustration-history-${suffix}@example.com`;
    const res = await request.post('http://localhost:3001/api/auth/register', {
      data: { email, name: 'Illustration History Tester', password: 'pw-test-1234' },
    });
    expect(res.ok()).toBeTruthy();
    user = (await res.json()) as RegisterResponse;
    createdEmails.push(email);

    // Set up route mocks BEFORE navigating so the initial fetch hits them.
    await page.route(`**/api/books/${BOOK_ID}`, async route => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      const body = {
        id: BOOK_ID,
        title: 'The Tiny Dragon',
        author: 'Test Author',
        description: 'A tiny dragon discovers a singing stone.',
        theme: 'fantasy',
        age_range: '4-7',
        cover_emoji: '🐉',
        cover_color: '#a78bfa',
        cover_url: null,
        price: 19.99,
        is_featured: 0,
        is_user_created: 1,
        status: 'draft',
        version: 1,
        characters: [{ role: 'primary', name: 'Wobble', descriptor: 'a tiny dragon' }],
        style_descriptor: null,
        style_reference_url: null,
        created_by: user.id,
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        pages: PAGES.map(p => ({
          ...p,
          illustration_url: p.page_number === 1 ? currentIllustrationUrl : p.illustration_url,
        })),
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    // BookDetail also fetches /versions for draft + owner combos. Return an
    // empty-ish snapshot list so the version-history section just shows
    // "no previous versions" and stays out of the way of this spec.
    await page.route(`**/api/books/${BOOK_ID}/versions`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route(`**/api/books/${BOOK_ID}/illustrations/1`, async route => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      illustrationsHits += 1;
      const versions = [
        {
          url: V3_URL,
          version: 3,
          created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
          feedback: 'lighter background',
        },
        {
          url: V2_URL,
          version: 2,
          created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          feedback: null,
        },
        {
          url: V1_URL,
          version: 1,
          created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
          feedback: V1_FEEDBACK,
        },
      ];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(versions) });
    });

    await page.route(`**/api/books/${BOOK_ID}/illustrations/1/revert`, async route => {
      revertHits += 1;
      // Verify the request carries the user's bearer token.
      const auth = route.request().headers()['authorization'];
      expect(auth).toBe(`Bearer ${user.token}`);
      expect(route.request().method()).toBe('PUT');
      lastRevertBody = JSON.parse(route.request().postData() ?? '{}') as { url?: string };
      currentIllustrationUrl = lastRevertBody.url ?? currentIllustrationUrl;

      const updated = {
        id: BOOK_ID,
        title: 'The Tiny Dragon',
        author: 'Test Author',
        description: 'A tiny dragon discovers a singing stone.',
        theme: 'fantasy',
        age_range: '4-7',
        cover_emoji: '🐉',
        cover_color: '#a78bfa',
        cover_url: null,
        price: 19.99,
        is_featured: 0,
        is_user_created: 1,
        status: 'draft',
        version: 1,
        characters: [{ role: 'primary', name: 'Wobble', descriptor: 'a tiny dragon' }],
        style_descriptor: null,
        style_reference_url: null,
        created_by: user.id,
        pages: PAGES.map(p => ({
          ...p,
          illustration_url: p.page_number === 1 ? currentIllustrationUrl : p.illustration_url,
        })),
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
    });

    // Visit the app first so localStorage is on the right origin, then set
    // the auth blob, then go to the book.
    await page.goto('/');
    await page.evaluate(({ id, email, name, token }) => {
      localStorage.setItem('storybook-auth', JSON.stringify({ id, email, name, token }));
    }, { id: user.id, email: user.email, name: user.name, token: user.token });
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

  test('revert to a prior illustration version updates the page image', async ({ page }) => {
    await page.goto(`/book/${BOOK_ID}`);

    // Current book is loaded.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('The Tiny Dragon');

    // Switch to Reader view — both views show the same carousel but Reader
    // exposes a single, unambiguous "History" button per visible page.
    await page.getByRole('button', { name: 'Reader view' }).click();

    // Reader is on page 1 by default. The current illustration is v3.
    const readerImg = page.locator(`img[src$="${V3_URL}"]`).first();
    await expect(readerImg).toBeVisible();

    // Open the per-page history carousel.
    await page.getByRole('button', { name: 'History' }).click();
    await expect.poll(() => illustrationsHits).toBeGreaterThanOrEqual(1);

    // Carousel renders three thumbnails. v3 is the active one and shows the
    // "Current" badge. v1 and v2 are revert buttons.
    const v1Btn = page.getByRole('button', { name: 'Revert to version 1' });
    const v2Btn = page.getByRole('button', { name: 'Revert to version 2' });
    await expect(v1Btn).toBeVisible();
    await expect(v2Btn).toBeVisible();
    await expect(page.getByText('Current', { exact: true })).toBeVisible();

    // v1's feedback quote is visible in the carousel.
    await expect(page.getByText(`“${V1_FEEDBACK}”`)).toBeVisible();

    // Click v1 — the revert call fires with v1's URL.
    await v1Btn.click();

    await expect.poll(() => revertHits).toBe(1);
    expect(lastRevertBody.url).toBe(V1_URL);

    // The displayed illustration switches to v1.
    await expect(page.locator(`img[src$="${V1_URL}"]`).first()).toBeVisible();
  });

  test("active version's thumbnail is not clickable", async ({ page }) => {
    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('The Tiny Dragon');

    await page.getByRole('button', { name: 'Reader view' }).click();
    await page.getByRole('button', { name: 'History' }).click();

    // Carousel rendered — wait for at least one revert button to appear.
    await expect(page.getByRole('button', { name: 'Revert to version 1' })).toBeVisible();

    // The active (v3) thumbnail renders as a non-button div, so there is no
    // button with that accessible name. The wrapping div is aria-labelled
    // "Version 3 (current)" and shows the "Current" badge.
    await expect(page.getByRole('button', { name: 'Revert to version 3' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Version 3 \(current\)$/ })).toHaveCount(0);
    await expect(page.getByLabel('Version 3 (current)')).toBeVisible();
    await expect(page.getByText('Current', { exact: true })).toBeVisible();

    // No revert call should have been fired by merely opening the carousel.
    expect(revertHits).toBe(0);
  });
});
