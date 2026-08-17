import { test, expect, type Page } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectTapTargets,
  forEachTheme,
  NAV_TAP_MIN,
  PRIMARY_TAP_MIN,
} from './_helpers';

/**
 * Mobile route smoke: every user-reachable route, at both mobile viewports, in both
 * themes. Runs under the `mobile-pixel` (393x851) and `mobile-small` (360x740)
 * projects only — see e2e/playwright.config.ts.
 *
 * `/admin` is intentionally excluded: it is admin-only, desktop-appropriate, and
 * explicitly out of scope (spec "Out of scope").
 *
 * The defect inventory below records what Task 1 measured and which task discharged
 * it. Each of Tasks 2-4 deletes its own `test.fixme()` entries as it lands; zero
 * remaining fixmes is the completion signal for the responsive-repair movement.
 */

/*
 * ── DEFECT INVENTORY (Task 1 output) ────────────────────────────────────────────
 * Derived empirically: this spec was run against master on 2026-08-16 at both mobile
 * viewports in both themes, and exactly the assertions that actually failed were marked
 * `test.fixme()`. Nothing was weakened to make a route pass, and no passing route was
 * marked. Entries are grouped by owning task so each task deletes only its own.
 *
 * Task 2 — client/src/components/Navbar.tsx — 16 fixmes (2 per route x 8 routes) — FIXED.
 *   The Navbar was the ONLY source of horizontal overflow in the app, and it failed on
 *   every route because it is global chrome:
 *     - Overflow: the right-hand `flex items-center gap-4` group (logo + Browse/auth icon
 *       links + "Create a Book" pill + theme toggle + cart) had a min-content width of
 *       ~422-431px and did not wrap, so documentElement.scrollWidth was ~422px at both a
 *       360px and a 393px viewport. Chromium then shrink-to-fit the whole page, which is
 *       why the app "looked fine" in a screenshot while being zoomed out.
 *     - Tap targets: below `sm` the link labels were `hidden sm:inline`, so each nav link
 *       collapsed to its bare lucide icon — an 18x18px hit area (first reported offender
 *       was "Browse"). That is under even the 24px WCAG 2.2 AA floor, let alone 44px.
 *   Discharged by collapsing the wordmark and the CTA text below `sm`, tightening gaps
 *   to `gap-0.5 sm:gap-4`, and lifting icon hit areas with `p-2 sm:p-0`. Re-measured on
 *   2026-08-16: documentElement.scrollWidth is exactly 360 / 393 on all eight routes in
 *   both themes, and the smallest nav hit area is the 30x30px logo link.
 *
 * Task 3 — client/src/pages/{Cart,Checkout}.tsx — NO smoke fixmes.
 *   Verified, not assumed: with a seeded cart, nothing inside <main> exceeds the viewport
 *   at 360px or 393px. The Cart item row does not overflow because its flex children
 *   shrink — it squishes instead (64px thumb + title + 3 quantity controls + w-20 price +
 *   delete inside 328px of usable width). Overflow cannot see that. Task 3 must be scoped
 *   against its own criteria in tasks.md (money-path.spec.ts, tap targets on the
 *   quantity/remove controls), NOT against this fixme list.
 *
 * Task 4 — client/src/{components/BookSpread,pages/CreateBook}.tsx — NO smoke fixmes.
 *   Same reason: the `grid grid-cols-2` spread and the wizard option grids shrink rather
 *   than overflow, so /book/:id and /create pass the overflow assertion once the Navbar
 *   is fixed. The reader being unusable at ~150px per page is a behavioural defect that
 *   only reader.spec.ts (Task 4) can catch.
 *
 * Task 2 has landed and this spec was re-run before its fixmes were deleted: with the
 * Navbar no longer forcing a 422px layout viewport, every route now lays out at its true
 * width, and no previously-masked overflow surfaced on the Task 3 or Task 4 routes.
 * ────────────────────────────────────────────────────────────────────────────────
 */

/** Primary chrome. Held to the WCAG 2.2 AA floor, not the HIG one — see _helpers.ts. */
const NAV_CHROME = 'nav a, nav button';

/** Submit controls on routes that have a form. Held to the HIG 44px bar. */
const FORM_SUBMIT = 'main form button[type="submit"]';

interface RouteCase {
  path: string;
  /** Blocks until the route has actually rendered, so no assertion measures a blank shell. */
  ready: (page: Page) => Promise<void>;
  /** Money-path routes render an empty state otherwise, which would assert nothing. */
  seedCart?: boolean;
  /** Submit-control selector, or null where the route has no form. */
  submit?: string;
}

const ROUTES: RouteCase[] = [
  {
    path: '/',
    ready: (page) => expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible(),
  },
  {
    path: '/cart',
    seedCart: true,
    ready: (page) => expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible(),
  },
  {
    path: '/checkout',
    seedCart: true,
    ready: (page) => expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible(),
    submit: FORM_SUBMIT,
  },
  {
    path: '/login',
    ready: (page) => expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible(),
    submit: FORM_SUBMIT,
  },
  {
    path: '/register',
    ready: (page) => expect(page.getByRole('heading', { name: 'Create Account' }).first()).toBeVisible(),
    submit: FORM_SUBMIT,
  },
  {
    path: '/create',
    ready: (page) => expect(page.getByRole('heading', { level: 1 })).toBeVisible(),
  },
  {
    path: '/my-books',
    // Logged out, this renders the "Sign in to see your books" prompt. The point of the
    // spec is the viewport, not the auth state — assert against whatever renders.
    ready: (page) => expect(page.getByRole('heading', { name: 'Sign in to see your books' })).toBeVisible(),
  },
];

/** Clears cart/auth/theme state, optionally seeds a cart, then lands on the route. */
async function landOn(page: Page, route: RouteCase): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  if (route.seedCart) {
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    await expect(page.locator('nav .bg-red-500')).toHaveText('1');
  }

  await page.goto(route.path);
  await route.ready(page);
}

for (const route of ROUTES) {
  test.describe(`Mobile smoke: ${route.path}`, () => {
    test.beforeEach(async ({ page }) => {
      await landOn(page, route);
    });

    test('does not scroll horizontally in either theme', async ({ page }) => {
      await forEachTheme(page, async (theme) => {
        await route.ready(page);
        await test.step(`${theme} mode`, () => expectNoHorizontalOverflow(page));
      });
    });

    test('navbar controls meet the tap-target floor in either theme', async ({ page }) => {
      await forEachTheme(page, async (theme) => {
        await route.ready(page);
        await test.step(`${theme} mode`, () => expectTapTargets(page, NAV_CHROME, NAV_TAP_MIN));
      });
    });

    if (route.submit) {
      const submit = route.submit;
      test('submit controls meet the tap-target floor in either theme', async ({ page }) => {
        await forEachTheme(page, async (theme) => {
          await route.ready(page);
          await test.step(`${theme} mode`, () => expectTapTargets(page, submit, PRIMARY_TAP_MIN));
        });
      });
    }
  });
}

test.describe('Mobile smoke: /book/:id', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();

    const href = await page.locator('a[href^="/book/"]').first().getAttribute('href');
    expect(href, 'no catalog card linked to a book detail page').toBeTruthy();
    await page.goto(href!);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('does not scroll horizontally in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await test.step(`${theme} mode`, () => expectNoHorizontalOverflow(page));
    });
  });

  test('navbar controls meet the tap-target floor in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await test.step(`${theme} mode`, () => expectTapTargets(page, NAV_CHROME, NAV_TAP_MIN));
    });
  });
});
