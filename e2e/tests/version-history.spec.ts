import { test, expect } from '@playwright/test';

// Story-version revert (T1.2) e2e — fully route-mocked.
//
// The real revise → restore path runs through the Claude API, which is
// expensive and flaky. We route-mock the three relevant /api/books endpoints
// so this spec is deterministic. Auth itself is real: we register a fresh
// user against the live server (cheap, no AI) and seed localStorage with the
// returned token, so /api/auth/me succeeds and the AuthContext hydrates
// normally on mount.

const BOOK_ID = 'test-draft-1';

const V1_PAGES = [
  { page_number: 1, text: 'Once upon a time there was a tiny dragon.', illustrationDescription: 'A tiny dragon in a sunlit meadow.' },
  { page_number: 2, text: 'The dragon loved collecting smooth river stones.', illustrationDescription: 'Dragon at a riverbank picking up stones.' },
  { page_number: 3, text: 'One day the dragon found a stone that hummed a song.', illustrationDescription: 'Dragon holding a glowing stone, wide-eyed.' },
];

const V2_PAGES = [
  { page_number: 1, text: 'High in the clouds, a tiny dragon learned to fly.', illustration_description: 'A tiny dragon mid-leap above the clouds.', illustration_url: null },
  { page_number: 2, text: 'She wobbled through wind and giggled at every gust.', illustration_description: 'Dragon catching gusts, giggling.', illustration_url: null },
  { page_number: 3, text: 'When the sun set, she sailed home on a pink breeze.', illustration_description: 'Dragon gliding home at sunset.', illustration_url: null },
];

const V2_DESCRIPTION = 'A wobbly little dragon learns to fly.';
const V1_DESCRIPTION = 'A tiny dragon discovers a singing stone.';

interface RegisterResponse {
  id: string;
  email: string;
  name: string;
  token: string;
}

test.describe('Version history — restore prior version', () => {
  let versionsHits = 0;
  let restoreHits = 0;
  let user: RegisterResponse;
  // Track every email we registered against the live server so afterAll can
  // delete them. With playwright's reuseExistingServer in dev, otherwise these
  // would accumulate in dev.db across runs.
  const createdEmails: string[] = [];

  test.beforeEach(async ({ page, request }) => {
    versionsHits = 0;
    restoreHits = 0;

    // Register a fresh user against the real server. Unique email per run.
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `version-history-${suffix}@example.com`;
    const res = await request.post('http://localhost:3001/api/auth/register', {
      data: { email, name: 'Version History Tester', password: 'pw-test-1234' },
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
        title: 'The Wobbly Dragon',
        author: 'Test Author',
        description: V2_DESCRIPTION,
        theme: 'fantasy',
        age_range: '4-7',
        cover_emoji: '🐉',
        cover_color: '#a78bfa',
        cover_url: null,
        price: 19.99,
        is_featured: 0,
        is_user_created: 1,
        status: 'draft',
        version: 2,
        characters: [{ role: 'primary', name: 'Wobble', descriptor: 'a tiny dragon' }],
        style_descriptor: null,
        style_reference_url: null,
        created_by: user.id,
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        pages: V2_PAGES.map((p, i) => ({ id: i + 1, book_id: BOOK_ID, ...p })),
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.route(`**/api/books/${BOOK_ID}/versions`, async route => {
      versionsHits += 1;
      // The endpoint returns versions ordered by version desc. The UI shows
      // versions.slice(1) — so the first entry is the current version and
      // subsequent entries are prior snapshots available to restore.
      const v2Snapshot = {
        id: 2,
        book_id: BOOK_ID,
        version: 2,
        pages_json: JSON.stringify(V2_PAGES.map(p => ({ page_number: p.page_number, text: p.text, illustrationDescription: p.illustration_description }))),
        description: V2_DESCRIPTION,
        characters_json: null,
        created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        pages: V2_PAGES.map(p => ({ page_number: p.page_number, text: p.text, illustrationDescription: p.illustration_description })),
      };
      const v1Snapshot = {
        id: 1,
        book_id: BOOK_ID,
        version: 1,
        pages_json: JSON.stringify(V1_PAGES),
        description: V1_DESCRIPTION,
        characters_json: null,
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
        pages: V1_PAGES,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([v2Snapshot, v1Snapshot]),
      });
    });

    await page.route(`**/api/books/${BOOK_ID}/versions/1/restore`, async route => {
      restoreHits += 1;
      // Verify the request carries the user's bearer token.
      const auth = route.request().headers()['authorization'];
      expect(auth).toBe(`Bearer ${user.token}`);
      expect(route.request().method()).toBe('PUT');

      // Restored book is v3 with v1's text/description and illustrations cleared.
      const restored = {
        id: BOOK_ID,
        title: 'The Wobbly Dragon',
        author: 'Test Author',
        description: V1_DESCRIPTION,
        theme: 'fantasy',
        age_range: '4-7',
        cover_emoji: '🐉',
        cover_color: '#a78bfa',
        cover_url: null,
        price: 19.99,
        is_featured: 0,
        is_user_created: 1,
        status: 'draft',
        version: 3,
        characters: [{ role: 'primary', name: 'Wobble', descriptor: 'a tiny dragon' }],
        style_descriptor: null,
        style_reference_url: null,
        created_by: user.id,
        pages: V1_PAGES.map((p, i) => ({
          id: i + 10,
          book_id: BOOK_ID,
          page_number: p.page_number,
          text: p.text,
          illustration_description: p.illustrationDescription,
          illustration_url: null,
        })),
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(restored) });
    });

    // Now seed localStorage and navigate. Visit the app first so localStorage
    // is on the right origin, then set the auth blob, then go to the book.
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

  test('restore prior version updates the book and refreshes history', async ({ page }) => {
    // Wire up the confirm() handler BEFORE the click that triggers it.
    let dialogMessage = '';
    page.once('dialog', dialog => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    await page.goto(`/book/${BOOK_ID}`);

    // Current book (v2) is visible.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('The Wobbly Dragon');
    await expect(page.getByText(V2_DESCRIPTION)).toBeVisible();

    // Version history section renders with a v1 row + Restore button.
    await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
    const restoreBtn = page.getByRole('button', { name: 'Restore version 1' });
    await expect(restoreBtn).toBeVisible();

    // History was fetched at least once on initial load. (React StrictMode
    // can double-fire effects in dev, so we don't pin the exact count here —
    // the post-restore assertion below verifies the re-fetch separately.)
    const hitsBeforeRestore = versionsHits;
    expect(hitsBeforeRestore).toBeGreaterThanOrEqual(1);

    await restoreBtn.click();

    // Confirm dialog warns about illustrations being cleared.
    await expect.poll(() => dialogMessage).toContain('Illustrations');
    expect(dialogMessage.toLowerCase()).toContain('cleared');

    // Book updates to the restored snapshot (v1 description + v1 page 1 text).
    await expect(page.getByText(V1_DESCRIPTION)).toBeVisible();
    // The BookSpread opens on the cover — advance to page 1 to assert page text.
    await page.getByRole('button', { name: 'Next spread' }).click();
    await expect(page.getByText(V1_PAGES[0].text)).toBeVisible();

    // Restore endpoint was hit exactly once.
    expect(restoreHits).toBe(1);

    // After restore, the UI re-fetches version history — count strictly
    // increases beyond the initial-load count.
    await expect.poll(() => versionsHits).toBeGreaterThan(hitsBeforeRestore);
  });

  test('restore prompt warns about illustrations being cleared and dismiss leaves book unchanged', async ({ page }) => {
    let dialogMessage = '';
    page.once('dialog', dialog => {
      dialogMessage = dialog.message();
      void dialog.dismiss();
    });

    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByText(V2_DESCRIPTION)).toBeVisible();

    const restoreBtn = page.getByRole('button', { name: 'Restore version 1' });
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    // Dialog message mentions illustrations being cleared.
    await expect.poll(() => dialogMessage).toContain('Illustrations');
    expect(dialogMessage.toLowerCase()).toContain('cleared');

    // Book is unchanged — still v2 description, restore endpoint never called.
    await expect(page.getByText(V2_DESCRIPTION)).toBeVisible();
    await expect(page.getByText(V1_DESCRIPTION)).toHaveCount(0);
    expect(restoreHits).toBe(0);
  });
});
