import { test, expect } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectTapTargets,
  forEachTheme,
  NAV_TAP_MIN,
  PRIMARY_TAP_MIN,
} from './_helpers';

/**
 * Fixture tests for the mobile assertion helpers.
 *
 * These exist because a mis-measuring helper fails silently — it passes everything and
 * the whole mobile suite becomes decorative. That is not hypothetical: the first
 * implementation of `expectNoHorizontalOverflow` compared against `window.innerWidth`
 * and passed on every route, because Chromium's mobile shrink-to-fit inflates
 * `innerWidth` to match overflowing content. Each helper is therefore proven to FAIL
 * when it should, not merely to pass when things are fine.
 */

/** Isolated fixture. The viewport meta is required — without it Chromium's mobile
 *  emulation falls back to a 980px layout viewport and the measurements are nonsense. */
async function setFixture(page: import('@playwright/test').Page, body: string): Promise<void> {
  await page.setContent(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>*{box-sizing:border-box}body{margin:0}</style>
  </head><body>${body}</body></html>`);
}

/** Asserts `fn` rejects, and returns the first line of the failure message. */
async function failureMessage(fn: () => Promise<void>): Promise<string> {
  let message: string | null = null;
  try {
    await fn();
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message, 'expected the helper to fail, but it passed').not.toBeNull();
  return message!;
}

test.describe('expectNoHorizontalOverflow', () => {
  test('passes on content that fits the viewport', async ({ page }) => {
    await setFixture(page, '<div style="width:100%;height:50px;background:#eee"></div>');
    await expectNoHorizontalOverflow(page);
  });

  test('fails on content wider than the viewport, and names the offender', async ({ page }) => {
    const width = page.viewportSize()!.width;
    await setFixture(page, `<div id="wide" style="width:${width + 62}px;height:50px;background:#eee"></div>`);
    const message = await failureMessage(() => expectNoHorizontalOverflow(page));
    expect(message).toContain(`exceeds the ${width}px viewport`);
    expect(message).toContain('Widest offenders');
    expect(message).toContain('<div');
  });

  test('fails on an un-shrinkable flex row — the Navbar failure mode', async ({ page }) => {
    const width = page.viewportSize()!.width;
    const cell = `<span style="flex:0 0 auto;width:${Math.ceil(width / 2)}px">x</span>`;
    await setFixture(page, `<div style="display:flex">${cell}${cell}${cell}</div>`);
    const message = await failureMessage(() => expectNoHorizontalOverflow(page));
    expect(message).toContain('horizontal overflow');
  });
});

test.describe('expectTapTargets', () => {
  test('passes when every matched element clears the floor', async ({ page }) => {
    await setFixture(page, '<button style="width:48px;height:48px">a</button><button style="width:44px;height:44px">b</button>');
    await expectTapTargets(page, 'button', PRIMARY_TAP_MIN);
  });

  test('fails on an undersized element and names it', async ({ page }) => {
    await setFixture(page, '<button aria-label="Tiny" style="width:18px;height:18px"></button>');
    const message = await failureMessage(() => expectTapTargets(page, 'button', NAV_TAP_MIN));
    expect(message).toContain('Tiny');
    expect(message).toContain(`below the ${NAV_TAP_MIN}px floor`);
  });

  test('fails on a stale selector rather than vacuously passing', async ({ page }) => {
    await setFixture(page, '<button style="width:48px;height:48px">a</button>');
    const message = await failureMessage(() => expectTapTargets(page, '.selector-that-matches-nothing', PRIMARY_TAP_MIN));
    expect(message).toContain('stale');
  });

  test('skips hidden elements so display:none controls do not fail the run', async ({ page }) => {
    await setFixture(page, '<button style="width:48px;height:48px">a</button><button style="display:none">b</button>');
    await expectTapTargets(page, 'button', PRIMARY_TAP_MIN);
  });
});

test.describe('forEachTheme', () => {
  test('runs the body once per theme and seeds the html class each time', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const seen: string[] = [];
    await forEachTheme(page, async (theme) => {
      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      const stored = await page.evaluate(() => localStorage.getItem('storybook-theme'));
      seen.push(`${theme}:${isDark ? 'dark-class' : 'no-dark-class'}:${stored}`);
    });

    expect(seen).toEqual(['light:no-dark-class:light', 'dark:dark-class:dark']);
  });

  test('propagates a body failure with the theme named at the call site', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const message = await failureMessage(() =>
      forEachTheme(page, async (theme) => {
        expect(false, `deliberate failure in ${theme} mode`).toBe(true);
      }),
    );
    expect(message).toContain('deliberate failure in light mode');
  });
});
