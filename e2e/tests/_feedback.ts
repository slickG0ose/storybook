import { expect, type Locator, type Page } from '@playwright/test';
import type { RegisteredUser } from './_editPublished';

/**
 * Shared fixtures for the tester feedback widget e2e specs (#157, spec:
 * `.code-captain/specs/tester-feedback-widget/spec.md`, Task 8).
 *
 * A non-`.spec.ts` module for the same reason as `_editPublished.ts`: Playwright refuses
 * to let one test file import another, and both `feedback.spec.ts` and
 * `mobile/feedback.spec.ts` need the mocked admin.
 *
 * **The tester path is real; the admin path is not.** Submitting runs against the live
 * `POST /api/feedback`. Viewing as admin mocks `/api/auth/me` (role `admin`) and every
 * `/api/admin/*` GET the page fires on mount, following `admin.spec.ts`. A real admin
 * would need a test-only promote endpoint, which is a privilege-escalation surface on the
 * auth guardrail (spec §Alternatives). The real admin routes are pinned by Supertest in
 * `server/src/routes/__tests__/adminFeedback.test.ts`.
 */

/** Seeded 5-page book; enters the spread reader, so `?theater=1` takes effect. */
export const SEEDED_BOOK_ID = 'luna-star-garden';
export const SEEDED_BOOK_PATH = `/book/${SEEDED_BOOK_ID}`;

/** The Navbar trigger. Icon-only below `sm`, so the aria-label is the stable handle. */
export function feedbackTrigger(page: Page): Locator {
  return page.getByRole('button', { name: 'Send feedback', exact: true });
}

export function feedbackDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Send feedback' });
}

/** The `fixed inset-0` overlay the dialog sits in — its direct parent. */
export function feedbackOverlay(page: Page): Locator {
  return feedbackDialog(page).locator('xpath=..');
}

/** Opens the dialog from the Navbar and waits for focus to land in the textarea. */
export async function openFeedback(page: Page): Promise<void> {
  await feedbackTrigger(page).click();
  await expect(feedbackDialog(page)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your feedback' })).toBeFocused();
}

export interface MockFeedbackItem {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  session_id: string;
  category: 'bug' | 'idea' | 'praise' | 'other';
  message: string;
  route: string;
  book_id: string | null;
  book_title: string | null;
  user_agent: string | null;
  viewport_width: number;
  viewport_height: number;
  theme: 'light' | 'dark';
  client_build: string | null;
  server_build: string | null;
  recent_errors: string[];
  status: 'new' | 'triaged' | 'done';
  created_at: string;
  updated_at: string;
}

/**
 * Two reports, shaped like `AdminFeedbackItemSchema`. The first carries a long unbroken
 * user agent, a recent error, and a book route, so the card's truncation and `break-all`
 * paths are both on screen when the mobile spec measures overflow.
 */
export function mockFeedbackItems(): MockFeedbackItem[] {
  const now = Date.now();
  return [
    {
      id: 'fb-e2e-1',
      user_id: 'tester-1',
      user_email: 'grandma.reads.aloud.every.night@example.com',
      user_name: 'Grandma Rose',
      session_id: '3f2a9c1e-7b44-4d2a-9a0e-5c1d2b3a4f5e',
      category: 'bug',
      message: 'The page turned twice when I tapped once.\nHappened on page 3.',
      route: `${SEEDED_BOOK_PATH}?theater=1`,
      book_id: SEEDED_BOOK_ID,
      book_title: 'Luna and the Star Garden',
      user_agent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP1A.240405.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
      viewport_width: 393,
      viewport_height: 851,
      theme: 'dark',
      client_build: '6b61570c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a',
      server_build: null,
      recent_errors: ['Uncaught TypeError: Cannot read properties of undefined (reading "pages")'],
      status: 'new',
      created_at: new Date(now - 1000 * 60 * 5).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 5).toISOString(),
    },
    {
      id: 'fb-e2e-2',
      user_id: 'tester-2',
      user_email: 'uncle.ben@example.com',
      user_name: 'Ben',
      session_id: '9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
      category: 'idea',
      message: 'Could the cart remember gift wrap?',
      route: '/cart',
      book_id: null,
      book_title: null,
      user_agent: null,
      viewport_width: 1280,
      viewport_height: 720,
      theme: 'light',
      client_build: null,
      server_build: null,
      recent_errors: [],
      status: 'new',
      created_at: new Date(now - 1000 * 60 * 60).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 60).toISOString(),
    },
  ];
}

export interface AdminMocks {
  items: MockFeedbackItem[];
  /** Every PATCH body, in order — `{ status }` is the whole contract. */
  patches: { id: string; body: unknown }[];
  /** Restore both items to `new` and forget the PATCHes — for `forEachTheme`'s second pass. */
  reset(): void;
}

/**
 * Makes `user` an admin in the browser and mocks every `/api/admin/*` GET `Admin.tsx`
 * fires on mount. Call before navigating so the first fetch hits the mocks.
 *
 * The non-feedback tabs get empty lists (and a zeroed spend summary — `Admin.tsx` reads
 * `spend.dailyByUser.length`, so `[]` there would crash the tab row). The feedback list
 * ignores the `?status=` filter on purpose: the spec asserts the request carried it.
 */
export async function installAdminMocks(page: Page, user: RegisteredUser): Promise<AdminMocks> {
  const items = mockFeedbackItems();
  const patches: AdminMocks['patches'] = [];

  await page.route('**/api/auth/me', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: user.id, email: user.email, name: user.name, role: 'admin' }),
    });
  });

  for (const path of ['users', 'books', 'orphan-illustrations', 'allowlist']) {
    await page.route(`**/api/admin/${path}`, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  }

  await page.route('**/api/admin/spend', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dailyByUser: [],
        monthlyTotalCents: 0,
        dailyLimitCents: 50,
        monthlyLimitCents: 2000,
        adminBypassEnabled: true,
      }),
    });
  });

  await page.route(/\/api\/admin\/feedback(\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(items) });
  });

  await page.route(/\/api\/admin\/feedback\/[^/?]+$/, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    const body = route.request().postDataJSON() as { status: MockFeedbackItem['status'] };
    patches.push({ id, body });
    const item = items.find(i => i.id === id);
    if (!item) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
      return;
    }
    item.status = body.status;
    item.updated_at = new Date().toISOString();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(item) });
  });

  return {
    items,
    patches,
    reset: () => {
      items.splice(0, items.length, ...mockFeedbackItems());
      patches.length = 0;
    },
  };
}

/** The Admin page's Feedback pill — "Feedback (N)". Anchored so it never matches "Send feedback". */
export function adminFeedbackTab(page: Page): Locator {
  return page.getByRole('button', { name: /^Feedback \(\d+\)$/ });
}
