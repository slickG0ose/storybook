import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme } from './_helpers';
import {
  BOOK_ID,
  ILLUSTRATED_PAGES,
  deleteUsers,
  installBookMocks,
  registerOwner,
  seedAuth,
  type RegisteredUser,
} from '../_editPublished';

/**
 * Font family + text size (#113, spec `.code-captain/specs/per-page-font-size/`) at mobile
 * width, under both mobile viewport projects and in both themes.
 *
 * WHICH HALF OF DONE-CRITERION #2 THIS CLAIMS. **Correctness only** (ADR-009) — that the
 * chosen tokens actually reach the rendered story text, that the two views keep their own
 * scales, that the picker stays tappable, and that the largest size does not push the
 * document wider than a phone screen. The **aesthetic** half — whether Fredoka at `xlarge`
 * reads well beside Nunito, whether the four families look like a coherent set — is not
 * claimed here and was discharged separately: Nick verified it in a browser on 2026-09-02,
 * in both themes, comparing Fredoka against Nunito side by side, with all four families
 * confirmed loading rather than falling back to system sans.
 *
 * WHY THE OVERFLOW ASSERTION IS THE POINT, NOT A FORMALITY. `xlarge` at a 360px viewport is
 * the one combination in this feature nobody has been able to look at: the manual pass on
 * 2026-09-02 could not get a real mobile viewport (resizing the window did not shrink the
 * page viewport), so `expectNoHorizontalOverflow` under the `mobile-small` project is the
 * ONLY thing covering it. If it fails, the fix belongs in the size scale in
 * `client/src/lib/typography.ts`, not in this spec.
 *
 * WHY BOTH VIEWS, WHEN THE TASK PLAN NAMED ONE. Task 8b gave Reader view its own scale map
 * (`READER_SIZE_CLASSES`) because Reader has always rendered larger than the spread —
 * `standard` is `text-base md:text-lg` in the spread and `text-xl` in Reader. Two maps that
 * must not converge, and the unit tests only see them in isolation. Driving the real
 * `Book view` / `Reader view` toggle (`BookDetail.tsx:993` — note the label is "Book view",
 * not "Spread view") and asserting the two views render the SAME book at DIFFERENT sizes is
 * the only end-to-end guard against one map being quietly aliased to the other.
 *
 * ASSERTIONS ARE ON COMPUTED STYLE, NOT ONLY ON CLASS NAMES. The highest-risk failure in
 * `lib/typography.ts` is Tailwind v4's scanner: a class name that is built rather than
 * written as a literal emits no utility at all, with no build error. A className assertion
 * passes happily in that world. `getComputedStyle` does not — it is what proves the utility
 * exists and that `font-atkinson` really resolves to the vendored face.
 *
 * NO PAID CALL IS MADE. The book is fully route-mocked via `../_editPublished.ts`, including
 * `PUT /:id/typography` (which is free on the real server anyway — no spend gate). Nothing
 * here touches `/revise` or `/illustrate`, and nothing may be changed to.
 */

/** The story text of page 1 in `ILLUSTRATED_PAGES`. Both views render it in a `<p>`. */
const PAGE_ONE_TEXT = 'Pip the hedgehog packed a very small suitcase.';

interface StoryTextStyle {
  fontSize: string;
  fontFamily: string;
  className: string;
}

/**
 * The story `<p>` for page 1, in whichever view is currently showing.
 *
 * `toHaveCount(1)` before anything else, deliberately: a locator that matches nothing
 * passes every subsequent `expect` vacuously, which is how PR #170 shipped a spec that
 * proved nothing. This is the fence for that.
 */
function storyText(page: Page): Locator {
  return page.locator('p').filter({ hasText: PAGE_ONE_TEXT });
}

async function storyTextStyle(page: Page, where: string): Promise<StoryTextStyle> {
  const paragraph = storyText(page);
  await expect(
    paragraph,
    `${where}: expected exactly one story <p> containing "${PAGE_ONE_TEXT}" — ` +
      `a zero-match locator would make every assertion below pass vacuously`,
  ).toHaveCount(1);
  await expect(paragraph, `${where}: the story text is in the DOM but not visible`).toBeVisible();

  return paragraph.evaluate((el) => {
    const computed = getComputedStyle(el);
    return {
      fontSize: computed.fontSize,
      fontFamily: computed.fontFamily,
      className: el.className,
    };
  });
}

/**
 * Spread view opens on the cover, which carries no story text — Reader view opens on page 1.
 * (The two views hold independent indices: `BookSpread`'s `spreadIndex` and `BookDetail`'s
 * `currentPage`.) So every spread-view assertion has to step forward one spread first, and
 * has to do it again after each view toggle, because toggling unmounts `BookSpread`.
 */
async function advanceToFirstStoryPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next spread' }).click();
  await expect(storyText(page)).toBeVisible();
}

test.describe('Typography on mobile', () => {
  // Two themes x (default read + two chip writes + a view toggle + a reload), twice over.
  test.setTimeout(120_000);

  test('the owner sets xlarge + atkinson and both views honour it, in either theme', async ({
    page,
    request,
  }) => {
    const user: RegisteredUser = await registerOwner(request, 'typography-mobile');
    const createdEmails = [user.email];

    try {
      const mocks = await installBookMocks(page, {
        status: 'draft',
        createdBy: user.id,
        pages: ILLUSTRATED_PAGES,
        token: user.token,
        // Explicit rather than inherited: this test's whole claim is that the picker moves
        // the book OFF the defaults, so the starting point has to be stated where a reader
        // can see it.
        typography: { font_family: 'fredoka', text_size: 'standard' },
      });

      // Reader view's per-page history fetch. Empty is the honest answer for a mocked book,
      // and mocking it keeps a 404 from the real server out of the run.
      await page.route(`**/api/books/${BOOK_ID}/illustrations/*`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      await seedAuth(page, user);
      await page.goto(`/book/${BOOK_ID}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      await forEachTheme(page, async (theme) => {
        await test.step(`${theme} mode`, async () => {
          // Both passes start from the same book. `forEachTheme` has already reloaded to
          // seed the theme, but that reload re-fetched whatever the PREVIOUS pass wrote, so
          // the reset needs a second one. Without it the dark pass would click chips that
          // are already selected and prove nothing about the write path.
          mocks.reset();
          await page.reload();
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

          await advanceToFirstStoryPage(page);

          // The before-picture. `fredoka` + `standard` is defined to reproduce the pre-#113
          // rendering exactly; capturing it here is what makes the change below visible
          // rather than asserted into a vacuum.
          const beforeSpread = await storyTextStyle(page, `[${theme}] spread, defaults`);
          expect(
            beforeSpread.className,
            `[${theme}] the default spread class is no longer the pre-#113 string`,
          ).toContain('text-base md:text-lg');
          expect(beforeSpread.fontSize, `[${theme}] default spread size drifted`).toBe('16px');
          expect(
            beforeSpread.fontFamily,
            `[${theme}] the default spread family is not Fredoka — font-display stopped resolving`,
          ).toContain('Fredoka');

          // The picker itself: 8 chips, owner + draft only, and every one of them a tap
          // target. Asserted before the clicks so a missing picker fails here rather than
          // as a confusing timeout on the chip click.
          await expect(
            page.getByTestId('typography-chip'),
            `[${theme}] expected 4 family chips + 4 size chips in the draft editor rail`,
          ).toHaveCount(8);
          await expectTapTargets(page, '[data-testid="typography-chip"]');

          await page.getByRole('button', { name: 'Extra large' }).click();
          await page.getByRole('button', { name: 'Atkinson Hyperlegible' }).click();

          // Two writes, both through the real `PUT /api/books/:id/typography`, and the
          // second carries the first's choice — the chip rows are independent controls over
          // one pair of tokens.
          await expect
            .poll(() => mocks.typography(), {
              message: `[${theme}] the chips did not persist both tokens through PUT /typography`,
            })
            .toEqual({ font_family: 'atkinson', text_size: 'xlarge' });

          const afterSpread = await storyTextStyle(page, `[${theme}] spread, xlarge + atkinson`);
          expect(
            afterSpread.className,
            `[${theme}] the spread map no longer emits the xlarge scale`,
          ).toContain('text-xl md:text-2xl');
          expect(afterSpread.className).toContain('font-atkinson');
          // Below the `md` breakpoint at every mobile project here, so `text-xl` wins.
          expect(
            afterSpread.fontSize,
            `[${theme}] xlarge did not reach the spread's story text — Tailwind may have ` +
              `tree-shaken the utility (see the header note on literal class strings)`,
          ).toBe('20px');
          expect(
            afterSpread.fontFamily,
            `[${theme}] font-atkinson did not resolve to the vendored face`,
          ).toContain('Atkinson Hyperlegible');

          // THE assertion this task exists for: the largest size on the smallest screen.
          await expectNoHorizontalOverflow(page);

          // ---- Reader view, same book, its own scale ----
          await page.getByRole('button', { name: /reader view/i }).click();

          const reader = await storyTextStyle(page, `[${theme}] reader, xlarge + atkinson`);
          expect(
            reader.className,
            `[${theme}] Reader view is not using READER_SIZE_CLASSES for xlarge`,
          ).toContain('text-3xl');
          expect(reader.className).toContain('font-atkinson');
          expect(
            reader.className,
            `[${theme}] Reader view grew a responsive step; its scale is single-column by ` +
              `design and Task 8b explicitly did not add one`,
          ).not.toContain('md:');
          expect(reader.fontSize, `[${theme}] reader xlarge is not text-3xl`).toBe('30px');
          expect(reader.fontFamily).toContain('Atkinson Hyperlegible');

          // The map-aliasing guard. Same book, same tokens, two views — and they MUST NOT
          // agree on size. If these ever match, one of the two scale maps in
          // `client/src/lib/typography.ts` has been pointed at the other, which the unit
          // tests cannot see because they only ever exercise one map at a time.
          expect(
            reader.fontSize,
            `[${theme}] Reader view and Book view rendered the same book at the same size ` +
              `(${reader.fontSize}) — the two scale maps have collapsed into one`,
          ).not.toBe(afterSpread.fontSize);

          await expectNoHorizontalOverflow(page);

          // Back to Book view, so the next theme pass starts where this one did.
          await page.getByRole('button', { name: /book view/i }).click();
        });
      });
    } finally {
      await deleteUsers(request, createdEmails);
    }
  });

  test('a published book renders its stored typography to a visitor, with no picker', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());

    await installBookMocks(page, {
      status: 'published',
      // Not this visitor — and the visitor is signed out entirely, so `isOwner` is false
      // twice over. Either alone should hide the picker; the point here is what a reader of
      // the catalog sees.
      createdBy: 'some-other-author',
      pages: ILLUSTRATED_PAGES,
      // A non-default pair, and deliberately Lexend: it is the family that stays `unloaded`
      // until something applies it, so a computed-style assertion on it cannot pass by
      // accident off some other face already on the page.
      typography: { font_family: 'lexend', text_size: 'large' },
    });

    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        await advanceToFirstStoryPage(page);

        await expect(
          page.getByTestId('typography-controls'),
          `[${theme}] the picker rendered for a signed-out visitor on a published book — ` +
            `the owner+draft fence in BookSpread has regressed`,
        ).toHaveCount(0);
        await expect(page.getByTestId('typography-chip')).toHaveCount(0);

        const spread = await storyTextStyle(page, `[${theme}] spread, lexend + large`);
        expect(spread.className).toContain('text-lg md:text-xl');
        expect(spread.className).toContain('font-lexend');
        expect(spread.fontSize, `[${theme}] large did not reach the spread's story text`).toBe('18px');
        expect(
          spread.fontFamily,
          `[${theme}] font-lexend did not resolve — the @theme token and the @font-face ` +
            `family name have drifted apart`,
        ).toContain('Lexend');

        // Not vacuous: Lexend is fetched only because the line above applied it. This is the
        // assertion that separates "the class name is present" from "the face is real",
        // and `document.fonts.check()` cannot make that distinction (see fonts.spec.ts).
        await expect
          .poll(
            async () => {
              await page.evaluate(async () => {
                await document.fonts.ready;
              });
              return page.evaluate(
                () =>
                  Array.from(document.fonts).filter(
                    (f) => f.family === 'Lexend' && f.status === 'loaded',
                  ).length,
              );
            },
            {
              message:
                `[${theme}] no loaded @font-face named "Lexend" after the story text asked ` +
                `for it — the story is rendering in a fallback`,
            },
          )
          .toBeGreaterThan(0);

        await expectNoHorizontalOverflow(page);

        await page.getByRole('button', { name: /reader view/i }).click();

        const reader = await storyTextStyle(page, `[${theme}] reader, lexend + large`);
        expect(reader.className).toContain('text-2xl');
        expect(reader.className).toContain('font-lexend');
        expect(reader.fontSize, `[${theme}] reader large is not text-2xl`).toBe('24px');
        expect(
          reader.fontSize,
          `[${theme}] Reader view and Book view rendered the same published book at the ` +
            `same size (${reader.fontSize}) — the two scale maps have collapsed into one`,
        ).not.toBe(spread.fontSize);

        await expectNoHorizontalOverflow(page);

        await page.getByRole('button', { name: /book view/i }).click();
      });
    });
  });
});
