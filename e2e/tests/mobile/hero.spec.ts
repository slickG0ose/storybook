import { test, expect } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectTapTargets,
  forEachTheme,
  PRIMARY_TAP_MIN,
} from './_helpers';

/**
 * Home hero at mobile widths: the art is present, the composition collapses to a single
 * column, nothing scrolls sideways, and the primary CTA still clears the 44px floor.
 * Runs under the `mobile-pixel` (393x851) and `mobile-small` (360x740) projects only —
 * see e2e/playwright.config.ts.
 *
 * WHICH HALF OF DONE-CRITERION #2 THIS CLAIMS. Per ADR-009, a spec that runs the flow in
 * both themes at a mobile viewport and asserts no horizontal overflow plus the tap-target
 * floor discharges the *correctness* half of CLAUDE.md done-criterion #2 ("verified in
 * both light and dark mode"). That is what this file claims, and only that. The
 * *aesthetic* half — does the art read on cream and on gray-900, does the mat do its job
 * in dark mode, does the purple CTA still out-shout the illustration — is a human pass
 * and belongs to Task 7 of the hero-visual spec. No assertion here should be read as
 * sign-off on how the hero looks.
 *
 * Desktop-width overflow is likewise NOT covered: expectNoHorizontalOverflow needs a
 * fixed viewport and this file only runs at the two mobile projects. The `lg` two-column
 * split is hand-checked in Task 7.
 */

/** The hero art. The accessible name is the `alt` string, which describes the bench scene. */
const HERO_ART = { role: 'img' as const, name: /bench/i };

/**
 * The hero CTA, addressed by href rather than by name: `main` scopes it away from the
 * Navbar's "Create a Book" pill and the footer's "Start a story", both of which point at
 * the same route from outside <main>.
 */
const HERO_CTA = 'main a[href$="/create"]';

test.describe('Mobile hero', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // The catalog below the fold is part of the document that the overflow sweep
    // measures, so let it render before anything is measured mid-paint.
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
  });

  test('shows the hero art with no horizontal overflow in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await expect(page.getByRole(HERO_ART.role, { name: HERO_ART.name })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
      await test.step(`${theme} mode`, () => expectNoHorizontalOverflow(page));
    });
  });

  test('collapses to a single column with the art below the CTA in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      const art = page.getByRole(HERO_ART.role, { name: HERO_ART.name });
      const cta = page.getByRole('link', { name: /Create Your Own Book/i });
      await expect(art).toBeVisible();
      await expect(cta).toBeVisible();

      // Measured back-to-back and with no interleaved action, so neither box can be
      // shifted by a scroll between the two reads.
      const artBox = await art.boundingBox();
      const ctaBox = await cta.boundingBox();
      expect(artBox, `hero art has no bounding box in ${theme} mode`).not.toBeNull();
      expect(ctaBox, `hero CTA has no bounding box in ${theme} mode`).not.toBeNull();

      // The substantive assertion. Below `lg` the hero must be one stack, art last — the
      // relationship, not the pixel values, is what is pinned. A side-by-side squeeze at
      // 360px would leave both elements visible and would pass a naive "both rendered"
      // check; it fails here because the art would start above the CTA's bottom edge.
      const ctaBottom = ctaBox!.y + ctaBox!.height;
      expect(
        artBox!.y,
        `hero did not collapse to a single column in ${theme} mode: the art's box starts at ` +
          `y=${artBox!.y.toFixed(1)}px, above the CTA's bottom edge at y=${ctaBottom.toFixed(1)}px — ` +
          `the two columns are sitting side by side at a ${page.viewportSize()!.width}px viewport`,
      ).toBeGreaterThanOrEqual(ctaBottom);
    });
  });

  test('hero CTA meets the tap-target floor in either theme', async ({ page }) => {
    await forEachTheme(page, async (theme) => {
      await expect(page.getByRole(HERO_ART.role, { name: HERO_ART.name })).toBeVisible();
      await test.step(`${theme} mode`, () => expectTapTargets(page, HERO_CTA, PRIMARY_TAP_MIN));
    });
  });
});
