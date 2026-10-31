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

/**
 * #182: the `/create` entry in ROUTES only ever measures step 1, so every control past
 * the first screen — including the age-range picker #172 rewrote — escaped both
 * assertions. These walk the wizard forward instead.
 *
 * Wizard state is plain React state, and `forEachTheme` reloads, which resets the
 * wizard to step 1. So the walk happens *inside* each theme's body, not in beforeEach.
 *
 * Step 3's "Generate My Story" is disabled while logged out, but still rendered and
 * still a tap target, so it is measured all the same.
 */
const WIZARD_STEP_2 = 'Build Your Cast';
const WIZARD_STEP_3 = 'Any Special Requests?';

/** Age-range chips (`Ages 3-5`, ...) — one per canonical AGE_RANGES entry. */
const AGE_CHIPS = 'main button:has-text("Ages ")';

/** Back / Next / Generate — the wizard's own navigation row. */
const WIZARD_NAV = 'main button:text-is("Back"), main button:text-is("Next"), main button:has-text("Generate My Story")';

/** Step 2's add-a-character buttons. */
const ADD_CHARACTER = 'main button:has-text("Add antagonist"), main button:has-text("Add supporting character")';

async function advanceToStep2(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Adventure/ }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: WIZARD_STEP_2 })).toBeVisible();
  await expect(page.locator(AGE_CHIPS).first()).toBeVisible();
}

async function advanceToStep3(page: Page): Promise<void> {
  await advanceToStep2(page);
  await page.getByPlaceholder('Name (e.g., Luna)').first().fill('Luna');
  await page.locator(AGE_CHIPS).first().click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: WIZARD_STEP_3 })).toBeVisible();
}

test.describe('Mobile smoke: /create wizard past step 1', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/create');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('step 2 (cast + age picker) does not scroll horizontally in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await advanceToStep2(page);
      await test.step(`${theme} mode`, () => expectNoHorizontalOverflow(page));
    });
  });

  test('step 2 age-range chips meet the tap-target floor in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await advanceToStep2(page);
      await test.step(`${theme} mode`, () => expectTapTargets(page, AGE_CHIPS, PRIMARY_TAP_MIN));
    });
  });

  test('step 2 cast and wizard-nav controls meet the tap-target floor in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await advanceToStep2(page);
      await test.step(`${theme} mode: add-character`, () => expectTapTargets(page, ADD_CHARACTER, PRIMARY_TAP_MIN));
      await test.step(`${theme} mode: Back / Next`, () => expectTapTargets(page, WIZARD_NAV, PRIMARY_TAP_MIN));
    });
  });

  test('step 3 does not scroll horizontally in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await advanceToStep3(page);
      await test.step(`${theme} mode`, () => expectNoHorizontalOverflow(page));
    });
  });

  test('step 3 wizard-nav controls meet the tap-target floor in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await advanceToStep3(page);
      await test.step(`${theme} mode`, () => expectTapTargets(page, WIZARD_NAV, PRIMARY_TAP_MIN));
    });
  });
});

/**
 * #145: below `sm` every Navbar label is `hidden sm:inline`, so the icon links carried no
 * accessible name at a mobile viewport at all — a screen reader announced them as
 * unlabelled links. `getByRole('link', { name })` succeeding at this viewport IS the
 * assertion: it can only find the link via its `aria-label`, since the visible text node
 * is not rendered here. Logged-out links only — `My Books` and `Admin` need an
 * authenticated session and are covered at mobile width by
 * `error-toast.spec.ts` (My Books) and `admin.spec.ts` (Admin).
 */
test.describe('Mobile smoke: navbar accessible names', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
  });

  test('every logged-out navbar link has an accessible name matching its visible label', async ({ page }) => {
    await forEachTheme(page, async () => {
      for (const name of ['StoryBook', 'Browse', 'Create a Book', 'Cart', 'Sign In']) {
        await expect(page.getByRole('link', { name, exact: true }), name).toBeVisible();
      }
    });
  });
});
