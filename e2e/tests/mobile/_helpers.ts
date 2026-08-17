import { expect, type Page } from '@playwright/test';

/**
 * Tap-target floors. Two bars, deliberately.
 *
 * PRIMARY_TAP_MIN (44px, Apple HIG) applies to money-path controls and primary CTAs —
 * anywhere a mis-tap costs the user something.
 *
 * NAV_TAP_MIN (24px, WCAG 2.2 AA "Target Size (Minimum)") applies to the Navbar's icon
 * chrome. Holding the navbar to 44px would force a layout the user has not agreed to
 * (tasks.md open question 4); the documented default there is to split the bar and make
 * the split visible at the call site rather than silently waiving it. Revisit if the
 * user rules otherwise.
 */
export const PRIMARY_TAP_MIN = 44;
export const NAV_TAP_MIN = 24;

/**
 * The document must not scroll horizontally. Catches fixed-width rows and overflowing
 * flex containers — the single highest-value mobile assertion.
 *
 * Measured against `page.viewportSize().width`, NOT `window.innerWidth`.
 * Chromium's mobile emulation applies shrink-to-fit: when content is wider than the
 * layout viewport the page zooms out and `window.innerWidth` grows to match, so
 * `scrollWidth - innerWidth` is ~0 even on a page that visibly overflows. Empirically:
 * at a 360px viewport the storefront reports innerWidth 422 because the Navbar row is
 * 422px wide. The configured viewport width is the only stable reference.
 *
 * 1px of tolerance absorbs subpixel rounding at deviceScaleFactor 3.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const url = page.url();
  const viewport = page.viewportSize();
  expect(viewport, `expectNoHorizontalOverflow needs a fixed viewport; got null at ${url}`).not.toBeNull();
  const width = viewport!.width;

  const { scrollWidth, innerWidth, offenders } = await page.evaluate((viewportWidth) => {
    const widest: { right: number; description: string }[] = [];
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= viewportWidth + 1) continue;
      const className = typeof element.className === 'string' ? element.className : '';
      widest.push({
        right: Math.round(rect.right),
        description: `<${element.tagName.toLowerCase()} class="${className.slice(0, 70)}">`,
      });
    }
    widest.sort((a, b) => b.right - a.right);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: widest.slice(0, 3),
    };
  }, width);

  const blame =
    offenders.length > 0
      ? ` Widest offenders: ${offenders.map((o) => `${o.description} extends to ${o.right}px`).join('; ')}.`
      : '';

  expect(
    scrollWidth - width,
    `horizontal overflow at ${url}: documentElement.scrollWidth ${scrollWidth}px exceeds the ${width}px viewport ` +
      `(window.innerWidth reports ${innerWidth}px — inflated by Chromium shrink-to-fit).${blame}`,
  ).toBeLessThanOrEqual(1);
}

/**
 * Every *visible* element matching `selector` must have a bounding box of at least
 * `min` x `min` CSS px.
 *
 * The selector is explicit on purpose: exceptions live in the calling spec where a
 * reviewer can see them, rather than being waived inside a blanket "all buttons" rule.
 */
export async function expectTapTargets(page: Page, selector: string, min = PRIMARY_TAP_MIN): Promise<void> {
  const url = page.url();
  const elements = await page.locator(selector).all();

  expect(
    elements.length,
    `no elements matched "${selector}" at ${url} — the selector is stale, which would silently pass`,
  ).toBeGreaterThan(0);

  for (const element of elements) {
    if (!(await element.isVisible())) continue;

    const box = await element.boundingBox();
    if (box === null) continue;

    const label =
      (await element.getAttribute('aria-label')) ??
      ((await element.textContent()) ?? '').trim().slice(0, 40);
    const where = `tap target "${label || '(unnamed)'}" (${selector}) at ${url}`;

    expect(box.width, `${where}: width ${box.width.toFixed(1)}px is below the ${min}px floor`).toBeGreaterThanOrEqual(min);
    expect(box.height, `${where}: height ${box.height.toFixed(1)}px is below the ${min}px floor`).toBeGreaterThanOrEqual(min);
  }
}

/**
 * Runs `body` twice — once with theme 'light', once with 'dark' — seeding the
 * localStorage key ThemeContext reads and reloading between runs.
 *
 * This is what mechanically discharges CLAUDE.md done-criterion #2 ("verified in both
 * light and dark mode") for mobile layout work: every assertion inside the body becomes
 * a mobile x theme assertion.
 *
 * The page must already be on the app origin (localStorage is origin-scoped), and the
 * reload preserves the current URL — navigate to the route under test first.
 */
export async function forEachTheme(
  page: Page,
  body: (theme: 'light' | 'dark') => Promise<void>,
): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => localStorage.setItem('storybook-theme', value), theme);
    await page.reload();

    const html = page.locator('html');
    if (theme === 'dark') {
      await expect(
        html,
        `theme seed failed for "${theme}": <html> is missing the "dark" class at ${page.url()}`,
      ).toHaveClass(/dark/);
    } else {
      await expect(
        html,
        `theme seed failed for "${theme}": <html> still carries the "dark" class at ${page.url()}`,
      ).not.toHaveClass(/dark/);
    }

    await body(theme);
  }
}
