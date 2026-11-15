import { test, expect, type Page } from '@playwright/test';
import { waitForActiveWorker, waitForController } from './_helpers';
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme } from '../mobile/_helpers';

/**
 * A crashed build must never strand the user on itself.
 *
 * 2026-11-11: a render crash above App's per-page ErrorBoundary unmounted the whole tree,
 * UpdateToast with it. The fixed build sat in the service worker's `waiting` slot, nothing
 * could offer it, and a plain reload keeps the tab on the old worker — so every reload
 * landed on the same blank page.
 *
 * Two ways back are pinned here, both against the production build on :4173:
 *   1. UpdateToast is mounted outside the root boundary, so it still appears over a crash.
 *   2. The root fallback's own "Reload the page" applies the waiting worker.
 *
 * The crash is real, not injected: malformed JSON under `storybook-auth` makes
 * AuthProvider's mount effect throw, which is above every page and the navbar.
 * (That parse is itself unguarded — out of scope here, it just makes a reliable trigger.)
 */

/**
 * Puts a second worker in the `waiting` slot — the state a deploy leaves a returning
 * visitor in.
 *
 * Re-registering the same scope with a different script URL (`sw.js?next-build`) is an
 * update by spec, and installs a new worker even though the bytes match. A real deploy
 * changes the bytes at the same URL instead, but that cannot be staged here: the update
 * check is fetched by the browser process, and neither `context.route` nor browser-level
 * CDP `Fetch` intercepts it (both tried — no worker ever waited). What is under test is
 * what happens once a worker *is* waiting, and that path is identical: UpdateToast learns
 * of it through workbox-window (`installed` with `isExternal`), and the generated worker
 * honours `SKIP_WAITING` from either button.
 */
async function stageWaitingWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active) throw new Error('no active worker to update');
    await navigator.serviceWorker.register(`${reg.active.scriptURL}?next-build`, { scope: reg.scope });
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return reg?.waiting?.state ?? null;
        }),
      { timeout: 20_000 },
    )
    .toBe('installed');
}

/**
 * Deterministic crash trigger: a storage fault the app does not guard.
 *
 * Until #210 this seeded a corrupt `storybook-auth` blob, but AuthContext now drops a
 * malformed blob on purpose, so that no longer crashes anything. Instead, an init script makes
 * `localStorage.getItem('storybook-auth')` throw, as real browsers do when storage is blocked
 * (a SecurityError). AuthProvider reads that key in a mount effect OUTSIDE its try/catch
 * (only the JSON.parse is guarded), and AuthProvider sits inside the root ErrorBoundary,
 * so the throw lands on the boundary. No test hook exists in app code.
 *
 * The fault is armed by a localStorage flag (read through the original getItem) so a test can
 * disarm it with `disarmCrash` and reload into a clean boot; the init script itself runs on
 * every navigation for the life of the page.
 */
const CRASH_FLAG = 'e2e-crash-auth-read';

async function crashAndReload(page: Page): Promise<void> {
  await page.addInitScript((flag) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (this: Storage, key: string) {
      if (key === 'storybook-auth' && original.call(this, flag) === '1') {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }
      return original.call(this, key);
    };
  }, CRASH_FLAG);
  await page.evaluate((flag) => localStorage.setItem(flag, '1'), CRASH_FLAG);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('This page hit a snag');
}

/** Clears the crash trigger so the next load boots cleanly. */
async function disarmCrash(page: Page): Promise<void> {
  await page.evaluate((flag) => localStorage.removeItem(flag), CRASH_FLAG);
}

/**
 * After the reload, the staged worker is the one in control. Asserted by script URL
 * rather than "nothing waiting": the reloaded page re-registers plain `sw.js`, which is
 * itself a new URL for this registration and may stage another worker behind it.
 */
async function expectUpdated(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page
          .evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)
          // The reload tears down the execution context mid-poll; that is a retry.
          .catch(() => null),
      { timeout: 15_000 },
    )
    .toMatch(/\?next-build$/);
}

test.describe('Recovering from a crashed build', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await waitForActiveWorker(page);
    // Claim this client while still on the first build.
    await page.reload();
    await waitForController(page);
  });

  test('the update prompt still appears over a crash, and applying it leaves the old build', async ({ page }) => {
    await crashAndReload(page);
    // The incident's blank page: no navbar, nothing. The root boundary must catch it.
    await expect(page.getByRole('heading', { name: 'This page hit a snag' })).toBeVisible();

    await stageWaitingWorker(page);

    const toast = page.getByTestId('update-toast');
    await expect(toast, 'the crash took the update prompt down with it').toBeVisible();

    // Clear the crash trigger so the next build boots cleanly, then take the update.
    await disarmCrash(page);
    await toast.getByRole('button', { name: 'Reload' }).click();

    await expectUpdated(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('navigation').first()).toBeVisible();
  });

  test('the crash fallback’s own reload applies a waiting update', async ({ page }) => {
    await crashAndReload(page);
    await stageWaitingWorker(page);

    // Dismiss the toast, so the only way forward is the fallback button.
    await page.getByTestId('update-toast').getByRole('button', { name: 'Later' }).click();
    await expect(page.getByTestId('update-toast')).toHaveCount(0);

    await disarmCrash(page);
    await page.getByRole('button', { name: 'Reload the page' }).click();

    await expectUpdated(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  // CLAUDE.md done-criterion #2, correctness half (ADR-009): the root fallback paints its
  // own page surface now that it replaces the shell, and the toast sits over it. Both
  // themes, phone width. The aesthetic half was a human look at the screenshots attached.
  test('the crash page and the update prompt fit a phone in both themes', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await crashAndReload(page);
    await stageWaitingWorker(page);

    await forEachTheme(page, async theme => {
      await expect(page.getByRole('alert')).toContainText('This page hit a snag');
      await expect(page.getByTestId('update-toast')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTapTargets(page, '[role="alert"] button');
      await expectTapTargets(page, '[data-testid="update-toast"] button:has-text("Reload"), [data-testid="update-toast"] button:has-text("Later")');
      const path = testInfo.outputPath(`crash-${theme}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`crash-${theme}`, { path, contentType: 'image/png' });
    });
  });
});
