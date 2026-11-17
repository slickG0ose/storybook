import { test, expect, type Locator } from '@playwright/test';
import { API_BASE } from '../../ports';
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme, PRIMARY_TAP_MIN } from './_helpers';

/**
 * Signed media links on mobile (signed-media-urls Task 8): an expired link recovers on its
 * own, and an unsigned link is refused. Both mobile viewports, both themes.
 *
 * WHAT THIS PINS.
 *  1. The first `GET /api/books/luna-star-garden` is rewritten so every media URL carries
 *     an `e` an hour in the past and a junk signature. The server answers those with 403,
 *     the image `onerror` reports the expiry (`client/src/lib/mediaRefresh.ts`), the page
 *     refetches the book, and the real signed art appears with no reload.
 *  2. A bare `/illustrations/...` request is refused with 403. The e2e API server runs the
 *     code default, `enforce` (playwright.config.ts no longer sets `MEDIA_URL_MODE`).
 *
 * WHICH HALF OF DONE-CRITERION #2 THIS CLAIMS. **Correctness only** (ADR-009): the page
 * fits the screen and the controls stay tappable after recovery, in both themes. Whether
 * the recovered page looks right is the aesthetic half and needs a human.
 *
 * NO PAID CALL IS MADE. Only the seeded book is read; nothing here generates anything.
 */

const BOOK_ID = 'luna-star-garden';
const BOOK_PATH = `/book/${BOOK_ID}`;
/** The seed's first page file, in `server/public/illustrations/luna-star-garden/`. */
const UNSIGNED_MEDIA = `${API_BASE}/illustrations/${BOOK_ID}/page-1.jpg`;
const PAGE_NAV = '[aria-label="Previous spread"], [aria-label="Next spread"]';

/** 43 `A`s: the right length for a base64url HMAC-SHA256 tag, and certainly the wrong value. */
const BAD_SIG = 'A'.repeat(43);

/** Rewrites a signed URL so it is expired an hour ago and carries a bad signature. */
function expire(url: string | null): string | null {
  if (url === null) return null;
  const base = url.split('?')[0];
  const hourAgo = Math.floor(Date.now() / 1000) - 3600;
  return `${base}?e=${hourAgo}&s=${BAD_SIG}`;
}

interface BookBody {
  cover_url: string | null;
  pages: { illustration_url: string | null }[];
  [key: string]: unknown;
}

async function expectRealImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  const src = (await image.getAttribute('src')) ?? '';
  const expiry = Number(new URL(src, API_BASE).searchParams.get('e'));
  expect(expiry * 1000, `src ${src} is not freshly signed`).toBeGreaterThan(Date.now());
}

test.describe('Signed media links on mobile', () => {
  test.setTimeout(60_000);

  test('an expired link recovers without a reload, in either theme', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        // Armed per theme: forEachTheme reloads, and `times: 1` is spent by the first load.
        await page.route(
          `**/api/books/${BOOK_ID}`,
          async (route) => {
            const response = await route.fetch();
            const body = (await response.json()) as BookBody;
            body.cover_url = expire(body.cover_url);
            for (const p of body.pages) p.illustration_url = expire(p.illustration_url);
            await route.fulfill({ response, json: body });
          },
          { times: 1 },
        );

        // Counts every book GET, rewritten or real: recovery needs a second one.
        let bookGets = 0;
        const count = (r: { url(): string; method(): string }) => {
          if (r.method() === 'GET' && r.url().endsWith(`/api/books/${BOOK_ID}`)) bookGets += 1;
        };
        page.on('request', count);
        await page.goto(BOOK_PATH);
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

        const art = page.locator(`main img[alt][src*="/illustrations/${BOOK_ID}/"]`).first();
        await expectRealImage(art);
        page.off('request', count);
        expect(bookGets, `[${theme}] the expired link never triggered a refetch`).toBeGreaterThanOrEqual(2);

        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, PAGE_NAV, PRIMARY_TAP_MIN);
      });
    });
  });

  test('an unsigned media link is refused', async ({ request }) => {
    const response = await request.get(UNSIGNED_MEDIA);
    expect(response.status()).toBe(403);
  });
});
