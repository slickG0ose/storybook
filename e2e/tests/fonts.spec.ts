import { test, expect } from '@playwright/test';
import { forEachTheme } from './mobile/_helpers';

/**
 * Guards the self-hosting done in #126.
 *
 * The failure mode this exists for is silent: if a `font-family` string in `index.css`
 * stops matching an `@font-face` name — a rename, a typo, a dropped quote — nothing
 * errors. The app just renders in system sans, and only a human who knows what Fredoka
 * looks like would notice. `document.fonts.check()` is the only cheap way to tell
 * "loaded" apart from "fell back".
 */
test.describe('Webfonts', () => {
  test('are served from this origin, never from Google', async ({ page }) => {
    // Exact hostname, not `url.includes(...)`. A substring test matches
    // `evil.test/?x=fonts.googleapis.com` as readily as the real host — CodeQL flags
    // exactly that as js/incomplete-url-substring-sanitization, and it is right to.
    const GOOGLE_FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

    const thirdParty: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        return; // not an absolute URL; nothing this test cares about
      }
      if (GOOGLE_FONT_HOSTS.has(hostname)) thirdParty.push(url);
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    expect(
      thirdParty,
      'the Google Fonts @import is back — text now waits on a third-party round trip',
    ).toEqual([]);
  });

  test('both families are really loaded, across the whole 400-700 axis', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();

    await forEachTheme(page, async (theme) => {
      await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      // NOT document.fonts.check(). Per spec that returns true when *nothing* matches the
      // family — the text is renderable in the fallback — so it passes just as happily on
      // a typo'd family name as on a working one. Verified: renaming the @font-face to
      // 'FredokaX' left all four check() calls returning true. Enumerating the actual
      // FontFace set is the assertion that distinguishes loaded from fell-back.
      const faces = await page.evaluate(() =>
        Array.from(document.fonts).map((f) => ({ family: f.family, weight: f.weight, status: f.status })),
      );

      for (const family of ['Fredoka', 'Nunito']) {
        const loaded = faces.filter((f) => f.family === family && f.status === 'loaded');
        expect(
          loaded.length,
          `no loaded @font-face named "${family}" in ${theme} mode — the app is rendering in ` +
            `system sans. Faces present: ${JSON.stringify(faces)}`,
        ).toBeGreaterThan(0);

        // The variable axis, pinned. Narrowing this to a single weight would make every
        // bold on the page a faux-bold, which no other assertion here would catch.
        for (const face of loaded) {
          expect(face.weight, `"${family}" lost its variable weight range in ${theme} mode`).toBe('400 700');
        }
      }

      // The latin-ext subsets should NOT have loaded: their unicode-range excludes
      // everything the storefront actually renders, and fetching them would be 40 KB
      // spent on nothing. This is the assertion that catches a dropped unicode-range.
      const extra = faces.filter((f) => f.status === 'loaded').length;
      expect(
        extra,
        `${extra} faces loaded in ${theme} mode; expected exactly the two latin subsets. ` +
          'A missing unicode-range makes the browser download latin-ext for every visitor.',
      ).toBe(2);
    });
  });

  test('headings resolve to Fredoka and body copy to Nunito', async ({ page }) => {
    await page.goto('/');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();

    // The families being *loaded* does not prove they are *applied*: --font-display and
    // --font-body could be pointing somewhere else entirely.
    await expect(h1).toHaveCSS('font-family', /Fredoka/);
    await expect(page.locator('body')).toHaveCSS('font-family', /Nunito/);
  });
});
