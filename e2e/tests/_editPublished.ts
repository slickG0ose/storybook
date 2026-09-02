import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE } from '../ports';

/**
 * Shared fixtures for the "withdraw to edit" e2e specs (#20, spec:
 * `.code-captain/specs/edit-published-books/spec.md`).
 *
 * Lives in a non-`.spec.ts` module on purpose: Playwright refuses to let one test file
 * import another, and `e2e/tests/mobile/edit-published.spec.ts` (Task 8) needs exactly this
 * setup wrapped in `forEachTheme`. Same reason `_speech.ts` and `mobile/_helpers.ts` are
 * shaped this way.
 *
 * **Auth is real; the book is not.** Registering a throwaway user against the live server is
 * cheap and exercises the genuine `AuthContext` hydration path. The book, by contrast, is
 * fully route-mocked: `POST /:id/revise` and `POST /:id/illustrate` are paid Claude and image
 * calls, and a spec that drives the publish loop against real rows would either need a seeded
 * owned book or would spend money. Mocking `/api/books/*` also lets a single test flip
 * `status` between `published` and `draft` and count the exact number of transition requests,
 * which is the whole point of specs 1-3.
 *
 * What that costs, stated plainly: **these specs prove the client's state machine, not the
 * server's draft gate.** The server side of the immutability fence — the six routes that 403
 * on a published book — is proven by Supertest in `server/src/routes/__tests__/books.test.ts`
 * (Task 1). Neither layer stands in for the other.
 */

export const BOOK_ID = 'edit-published-e2e';

/**
 * A 1x1 transparent PNG. `api()` is the identity function in dev (empty `VITE_API_BASE_URL`),
 * so a data URL passes straight through to `<img src>` and loads without a network round trip
 * — no 404 noise for an illustration file that was never generated.
 */
export const STUB_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export interface PageFixture {
  page_number: number;
  text: string;
  illustration_description: string;
  illustration_url: string | null;
}

/**
 * The two typography tokens `Book` carries since #113 (`font_family` / `text_size`).
 *
 * Re-declared here rather than imported from `@storybook/shared`: `e2e/` has no dependency
 * on the workspace package, and every other shape in this file (`PageFixture`,
 * `RegisteredUser`) is a local structural copy for the same reason.
 *
 * **These fields are not optional in the mock.** `resolveTypography` indexes its class maps
 * by these values and dereferences the result, so a book row that omits them throws inside
 * `BookSpread`'s render — the page mounts to a blank screen with no `<h1>`, and every spec
 * built on this fixture fails at its first `toBeVisible`. Leaving them out is not a
 * degraded fixture; it is a broken one.
 */
export type MockFontFamily = 'fredoka' | 'nunito' | 'atkinson' | 'lexend';
export type MockTextSize = 'cozy' | 'standard' | 'large' | 'xlarge';

export interface MockTypography {
  font_family: MockFontFamily;
  text_size: MockTextSize;
}

/**
 * The Prisma column defaults, which are defined to reproduce the pre-#113 rendering
 * exactly. Every spec that does not care about typography gets these, so the fixture's
 * appearance is unchanged from before #113 landed.
 */
export const DEFAULT_TYPOGRAPHY: MockTypography = { font_family: 'fredoka', text_size: 'standard' };

/** Both pages illustrated — publishing needs no unillustrated confirm. */
export const ILLUSTRATED_PAGES: PageFixture[] = [
  {
    page_number: 1,
    text: 'Pip the hedgehog packed a very small suitcase.',
    illustration_description: 'A hedgehog closing a tiny suitcase by lamplight.',
    illustration_url: STUB_IMAGE,
  },
  {
    page_number: 2,
    text: 'The train to the mountains left at half past dawn.',
    illustration_description: 'A little train winding up a mountain at sunrise.',
    illustration_url: STUB_IMAGE,
  },
];

/**
 * Page 1 illustrated, pages 2-3 not. Serves two specs at once: the unillustrated publish
 * confirm reads "2 of 3", and the immutability fence gets one page that would show
 * Regenerate/History and one that would show "Generate illustration" if the `isDraft` gate at
 * `BookDetail.tsx:851`/`:941` ever regressed.
 */
export const MIXED_PAGES: PageFixture[] = [
  {
    page_number: 1,
    text: 'Pip the hedgehog packed a very small suitcase.',
    illustration_description: 'A hedgehog closing a tiny suitcase by lamplight.',
    illustration_url: STUB_IMAGE,
  },
  {
    page_number: 2,
    text: 'The train to the mountains left at half past dawn.',
    illustration_description: 'A little train winding up a mountain at sunrise.',
    illustration_url: null,
  },
  {
    page_number: 3,
    text: 'At the top, the clouds were close enough to pat.',
    illustration_description: 'A hedgehog patting a low cloud on a summit.',
    illustration_url: null,
  },
];

export interface RegisteredUser {
  id: string;
  email: string;
  name: string;
  token: string;
}

/**
 * Registers a fresh allowlisted user against the live server. Registration is closed by
 * default (F4a / #5), so the address is opted in through the test-only endpoint first — the
 * spec still goes through the real `POST /api/auth/register`.
 *
 * Push the returned `email` onto a list the caller deletes in `afterAll`; with
 * `reuseExistingServer` in dev these otherwise pile up in `dev.db` run after run.
 */
export async function registerOwner(
  request: APIRequestContext,
  label: string,
): Promise<RegisteredUser> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `${label}-${suffix}@example.com`;

  const allow = await request.post(`${API_BASE}/api/_test/allow-email`, {
    data: { email },
    headers: { 'x-test-secret': 'dev-test-secret' },
  });
  expect(allow.ok()).toBeTruthy();

  const res = await request.post(`${API_BASE}/api/auth/register`, {
    data: { email, name: 'Edit Published Tester', password: 'pw-test-1234' },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as RegisteredUser;
}

/**
 * Best-effort cleanup of the users a spec registered. Called from `afterAll`, so a throw
 * here fails the whole describe block — and Playwright attributes a failed hook to the
 * last test in it, naming a spec whose body passed. That is exactly how #166 presented:
 * a `socket hang up` from this loop was reported as a mobile layout assertion failing.
 *
 * So each delete is swallowed rather than asserted. This is cleanup, not a test: a user
 * row left behind costs a stale row in `dev.db`, while a throw costs a false red on an
 * unrelated spec. One retry covers the transient-reset case; anything that fails twice
 * is left for `db:reset`.
 *
 * What the swallow gives up is narrower than it looks. Playwright's `request.delete` does
 * not throw on a non-2xx, and this loop never checked `res.ok()`, so a real regression in
 * `/api/_test/user-by-email` (a 401 from a rotated secret, a 500) was already invisible
 * here — that contract is pinned in `server/src/routes/__tests__/test.test.ts`, not by
 * this call. Only a transport-level failure is surrendered, and `registerOwner`'s
 * `expect(allow.ok())` in `beforeEach` catches a dead server in the same run anyway. The
 * `console.warn` keeps a systematic double-failure visible in the report without putting
 * a false red back on an unrelated spec.
 *
 * Leaked rows are inert: `registerOwner` mints addresses with a timestamp and a random
 * suffix, so an abandoned row cannot collide with a later run, and the endpoint already
 * leaves the `AllowedEmail` row behind unconditionally. `emails` is cleared unconditionally
 * only because every caller holds a describe-scoped array consumed exactly once — the
 * clear is tidiness, not correctness.
 */
export async function deleteUsers(request: APIRequestContext, emails: string[]): Promise<void> {
  for (const email of emails) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await request.delete(`${API_BASE}/api/_test/user-by-email`, {
          data: { email },
          headers: { 'x-test-secret': 'dev-test-secret' },
          timeout: 5_000,
        });
        break;
      } catch (err) {
        if (attempt === 1) {
          // Abandoned, not fatal — see the docblock. Logged so a systematic teardown
          // failure is still legible in the report instead of vanishing.
          console.warn(`[deleteUsers] giving up on ${email} after 2 attempts: ${String(err)}`);
        }
      }
    }
  }
  emails.length = 0;
}

/**
 * Seeds `storybook-auth` so `AuthContext` hydrates on mount. Visits `/` first so
 * `localStorage` is written on the app's origin.
 */
export async function seedAuth(page: Page, user: RegisteredUser): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ id, email, name, token }) => {
      localStorage.setItem('storybook-auth', JSON.stringify({ id, email, name, token }));
    },
    { id: user.id, email: user.email, name: user.name, token: user.token },
  );
}

export interface BookMockOptions {
  /** Starting catalog state. */
  status: 'published' | 'draft';
  /** `book.created_by`. Pass a foreign id to exercise the non-owner path. */
  createdBy: string;
  pages: PageFixture[];
  /** Bearer token the transition routes assert on. Omit to skip the check. */
  token?: string;
  /**
   * Starting `font_family` / `text_size` (#113). Defaults to the DB defaults. The
   * `PUT /:id/typography` mock overwrites this in place, so a later GET — including the
   * reload `forEachTheme` does between themes — agrees with the write that just happened.
   */
  typography?: MockTypography;
}

export interface BookMocks {
  /** Transition-request counts. `expect(mocks.hits.unpublish).toBe(0)` is the confirm fence. */
  hits: { unpublish: number; publish: number; typography: number };
  /** Current mocked `status`, so a spec can assert the server's view, not just the DOM's. */
  status(): 'published' | 'draft';
  /** Current mocked typography, so a spec can assert what the PUT actually sent. */
  typography(): MockTypography;
  /**
   * Restore the initial status and typography, and zero the counters — for `forEachTheme`'s
   * repeat passes, where each theme should start from the same book the previous one did.
   */
  reset(): void;
}

/**
 * Installs the `/api/books/:id` mocks. **Call before navigating to `/book/:id`** so the first
 * fetch hits them.
 *
 * `publish` / `unpublish` mutate the mock's own `status`, so a later GET (the stale-403
 * refetch, or a `forEachTheme` reload) agrees with the transition that just happened. Both
 * respond with the book row **without `pages`**, which is what `BookSchema` actually returns —
 * `BookDetail` merges rather than replaces precisely because of that, and a mock that helpfully
 * included `pages` would hide a regression in the merge.
 */
export async function installBookMocks(page: Page, opts: BookMockOptions): Promise<BookMocks> {
  const initialStatus = opts.status;
  const initialTypography = opts.typography ?? DEFAULT_TYPOGRAPHY;
  let status: 'published' | 'draft' = opts.status;
  let typography: MockTypography = initialTypography;
  const hits = { unpublish: 0, publish: 0, typography: 0 };

  const bookRow = () => ({
    id: BOOK_ID,
    title: 'Pip Goes to the Mountains',
    author: 'Test Author',
    description: 'A hedgehog takes the early train.',
    theme: 'adventure',
    age_range: '4-7',
    cover_emoji: '🦔',
    cover_color: '#a78bfa',
    cover_url: null,
    price: 14.99,
    is_featured: 0,
    is_user_created: 1,
    status,
    version: 2,
    characters: [{ role: 'primary', name: 'Pip', descriptor: 'a small hedgehog' }],
    style_descriptor: null,
    style_reference_url: null,
    image_provider: null,
    image_model: null,
    // Non-null on the wire since #113 — `hydrateBook` spreads the whole Prisma row and the
    // columns have DB defaults, so every real book response carries both.
    font_family: typography.font_family,
    text_size: typography.text_size,
    created_by: opts.createdBy,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  });

  const fullBook = () => ({
    ...bookRow(),
    pages: opts.pages.map((p, i) => ({ id: i + 1, book_id: BOOK_ID, ...p })),
  });

  await page.route(`**/api/books/${BOOK_ID}`, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fullBook()),
    });
  });

  // Owner + draft mounts the version-history panel, which fetches on mount. Empty list is the
  // honest answer for a book that has never been revised; the panel renders its heading and
  // its "No previous versions yet" line, which is all the loop spec asserts on.
  await page.route(`**/api/books/${BOOK_ID}/versions`, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route(`**/api/books/${BOOK_ID}/unpublish`, async route => {
    hits.unpublish += 1;
    expect(route.request().method()).toBe('PUT');
    if (opts.token) {
      expect(route.request().headers()['authorization']).toBe(`Bearer ${opts.token}`);
    }
    status = 'draft';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bookRow()),
    });
  });

  await page.route(`**/api/books/${BOOK_ID}/publish`, async route => {
    hits.publish += 1;
    expect(route.request().method()).toBe('PUT');
    if (opts.token) {
      expect(route.request().headers()['authorization']).toBe(`Bearer ${opts.token}`);
    }
    status = 'published';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bookRow()),
    });
  });

  /**
   * `PUT /:id/typography` (#113). Free — no spend gate on the real route — so unlike
   * `/revise` and `/illustrate` this one is mocked for state, not for cost: the write has to
   * stick so the GET that follows a `forEachTheme` reload returns what the chip just set.
   *
   * Responds with the FULL book including `pages`, matching `BookTypographyResponseSchema`
   * (= `BookWithPagesSchema`). `BookDetail` replaces its whole `book` state with this
   * response, so a mock that echoed only the row would blank the reader.
   */
  await page.route(`**/api/books/${BOOK_ID}/typography`, async route => {
    hits.typography += 1;
    expect(route.request().method()).toBe('PUT');
    if (opts.token) {
      expect(route.request().headers()['authorization']).toBe(`Bearer ${opts.token}`);
    }
    typography = JSON.parse(route.request().postData() ?? '{}') as MockTypography;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fullBook()),
    });
  });

  return {
    hits,
    status: () => status,
    typography: () => typography,
    reset: () => {
      status = initialStatus;
      typography = initialTypography;
      hits.unpublish = 0;
      hits.publish = 0;
      hits.typography = 0;
    },
  };
}
