import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Home hero rotation (#127, spec `.code-captain/specs/hero-rotation/`).
 *
 * WHICH HALF OF DONE-CRITERION #2 THIS CLAIMS. **Correctness only.** This file runs at
 * the default desktop viewport under the `chromium` project and asserts mechanical
 * properties: that a rotation happens at all, that the hero's box does not move while it
 * happens, that the LCP frame is never re-`src`ed, that the frame the visitor sees
 * actually decoded, and that exactly one hero `<img>` carries an accessible name. The
 * *aesthetic* half — does each frame read on cream and on gray-900, does the purple CTA
 * still out-shout an illustration it was not composed against — is Task 7's manual pass
 * and is the user's, and is still outstanding. Nothing here should be read as sign-off
 * on how the rotation looks.
 *
 * REQUIRES A HYDRATED DATABASE. `GET /api/hero/pool` returns `{ frames: [] }` — and the
 * hero correctly stays on frame 0 forever — unless the demo book is seeded with both
 * `is_hero_eligible` and `hero_consent_at` set. Run `cd server && npm run db:hydrate`
 * (upsert-only, safe) before this spec. Every wait below names that as the likely cause
 * on timeout, because "the rotating layer never appeared" is otherwise indistinguishable
 * from a real regression.
 */

/** `HERO_ROTATE_MS` (7000) + `HERO_FADE_MS` (600), with room for a slow decode. */
const SWAP_TIMEOUT_MS = 20_000;

// The whole point of this spec is to watch an animation, so opt out of any
// reduced-motion default the runner might carry: `useHeroPool` suppresses rotation
// entirely under `prefers-reduced-motion: reduce`, and a suppressed rotation would look
// like a broken one here. It goes through `contextOptions` because `reducedMotion` is
// not a top-level `use` option in this Playwright version — set directly it type-errors,
// and would be a no-op rather than the guard it is meant to be.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

/** Layer 0 — the bundled LCP frame. The only accessibly-named image in the hero. */
function layerZero(page: Page): Locator {
  return page.getByRole('img', { name: /bench/i });
}

/**
 * Layer 1 — the rotating frame. Addressed by `aria-hidden`, not by role: it is
 * deliberately nameless (spec §4), so no role-based selector can reach it, and that
 * absence is exactly what the last test in this file pins.
 */
function layerOne(page: Page): Locator {
  return layerZero(page).locator('xpath=..').locator('img[aria-hidden="true"]');
}

/** The `relative aspect-square` box both layers stack into. */
function heroArtBox(page: Page): Locator {
  return layerZero(page).locator('xpath=..');
}

/** The white mat that reserves the hero's space — the box a CLS regression would move. */
function heroMat(page: Page): Locator {
  return layerZero(page).locator('xpath=../..');
}

const NO_ROTATION =
  'the rotating layer never appeared — either the pool is empty (run `cd server && ' +
  'npm run db:hydrate`) or rotation regressed';

/** Waits for a pool frame to be on screen and returns its `src`. */
async function waitForRotation(page: Page): Promise<string> {
  await expect(layerOne(page)).toBeAttached({ timeout: SWAP_TIMEOUT_MS });
  await expect
    .poll(() => layerOne(page).getAttribute('src'), { message: NO_ROTATION, timeout: SWAP_TIMEOUT_MS })
    .toContain('/hero/');
  return (await layerOne(page).getAttribute('src')) ?? '';
}

/** Waits for the rotating layer to move off `from`, and returns the new `src`. */
async function waitForSwapAway(page: Page, from: string): Promise<string> {
  await expect
    .poll(() => layerOne(page).getAttribute('src'), {
      message: `the rotating layer never advanced past ${from} — the pool may hold only one frame`,
      timeout: SWAP_TIMEOUT_MS,
    })
    .not.toBe(from);
  return (await layerOne(page).getAttribute('src')) ?? '';
}

test.describe('Hero rotation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // The catalog below the hero is part of the document whose layout a CLS regression
    // would disturb, so let it land before anything is measured.
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
    await expect(layerZero(page)).toBeVisible();
  });

  test('rotates a pool frame in over the bundled hero', async ({ page }) => {
    const src = await waitForRotation(page);
    // Served by Express from server/public/hero/, not compiled into the client bundle —
    // the whole delivery split the spec turns on.
    expect(src).toMatch(/\/hero\/[^/]+\/p\d+-\d+\.webp$/);
  });

  test('the rotating frame actually decoded', async ({ page }) => {
    await waitForRotation(page);
    // Same broken-box guard home.spec.ts:22 uses. The layer carries width/height and
    // inset-0, so it occupies its box whether or not the bytes ever arrived; naturalWidth
    // is what distinguishes "decoded" from "404 fell through to index.html".
    await expect
      .poll(() => layerOne(page).evaluate((el) => (el as HTMLImageElement).naturalWidth), {
        message: 'the rotating hero frame never decoded — check the /hero proxy and the derived artifacts',
      })
      .toBeGreaterThan(0);
  });

  test('the hero box does not move across a swap (zero CLS, measured)', async ({ page }) => {
    const first = await waitForRotation(page);
    const before = await heroMat(page).boundingBox();
    expect(before, 'the hero mat has no bounding box').not.toBeNull();

    await waitForSwapAway(page, first);
    const after = await heroMat(page).boundingBox();

    // The measured form of the CLS claim: only `opacity` animates, so every component of
    // the rect must be byte-identical across the swap. A layout property sneaking into
    // the crossfade shows up here as a fractional difference.
    expect(after, `the hero mat moved across a frame swap: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`).toEqual(before);
  });

  test('the LCP frame is never re-src-ed', async ({ page }) => {
    const lcpBefore = await layerZero(page).getAttribute('src');
    expect(lcpBefore, 'layer 0 has no src').not.toBeNull();

    const first = await waitForRotation(page);
    await waitForSwapAway(page, first);

    // Rotation adds a sibling layer; it never touches the element that is the LCP
    // candidate. If this ever fails, the LCP guarantee ADR-014 bought is gone.
    expect(await layerZero(page).getAttribute('src')).toBe(lcpBefore);
  });

  test('exactly one hero image is accessibly named after rotation', async ({ page }) => {
    const first = await waitForRotation(page);
    await waitForSwapAway(page, first);

    // Two <img> elements are on screen...
    await expect(heroArtBox(page).locator('img')).toHaveCount(2);
    // ...and exactly one of them is exposed to the accessibility tree. A role-based query
    // skips aria-hidden nodes, so this counts named images rather than elements. This is
    // the invariant the three pinned /bench/i selectors depend on, and it must hold no
    // matter how many frames have played.
    await expect(heroArtBox(page).getByRole('img')).toHaveCount(1);
    await expect(layerZero(page)).toHaveCount(1);
    await expect(layerZero(page)).toBeVisible();
  });
});
