import { test, expect, type Page } from '@playwright/test';
import { installFakeSpeech, installNoSpeech } from './_speech';

/**
 * Read-aloud on the desktop reader.
 *
 * Every assertion here runs against the injected fake synthesiser in `_speech.ts`, because
 * headless Chromium has no speech engine. **These tests prove the state machine and the UI,
 * not that anything is audible** — audibility is the manual listen in the spec's autonomy
 * ledger. What they can prove is the part most likely to break: that the highlight tracks
 * the spoken sentence, that the page turns itself at the end of one, and that abandoning a
 * page mid-sentence does not leave a stale utterance driving the reader.
 */

/** The seeded 5-page book the desktop and mobile reader specs both read. */
const BOOK_PATH = '/book/luna-star-garden';

/** Page 1's two sentences, verbatim from the seed — the chunker splits exactly here. */
const PAGE_1_FIRST = 'Luna loved the night sky more than anything.';
const PAGE_1_SECOND = 'Every evening, she would climb to the top of Willow Hill';

async function openReaderAtPageOne(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto(BOOK_PATH);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');
  await page.getByRole('button', { name: 'Next spread' }).click();
  await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');
}

test.describe('Read-aloud narration', () => {
  test('mounts the player without disturbing page navigation', async ({ page }) => {
    await installFakeSpeech(page);
    await page.goto(BOOK_PATH);

    const player = page.getByRole('group', { name: 'Read aloud' });
    await expect(player).toBeVisible();
    await expect(page.getByTestId('narration-player')).toHaveCount(1);

    // The settings disclosure is closed at every breakpoint — one DOM shape, so desktop and
    // mobile never diverge into two things to verify. Desktop pays one extra click for it.
    await expect(page.getByTestId('narration-settings')).toBeVisible();
    await expect(page.locator('[data-testid="narration-settings"][open]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();

    // Regression fence: mounting the player must not touch the existing spread controls.
    await expect(page.getByTestId('spread-position')).toHaveText('Cover');
    await page.getByRole('button', { name: 'Next spread' }).click();
    await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');
  });

  test('Play highlights the first sentence, then advances to the second on its own', async ({
    page,
  }) => {
    // Deliberately slow: a sentence has to stay on screen long enough for an assertion to
    // observe it. A 150ms chunk would come and go between two poll intervals.
    await installFakeSpeech(page, { chunkMs: 1200 });
    await openReaderAtPageOne(page);

    await page.getByRole('button', { name: 'Play' }).click();

    const highlight = page.getByTestId('narration-highlight');
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toContainText(PAGE_1_FIRST);

    // No further interaction: the queued utterance's `end` is what moves the highlight.
    await expect(highlight).toContainText(PAGE_1_SECOND);
  });

  test('turns the page by itself after the last sentence of a page', async ({ page }) => {
    await installFakeSpeech(page, { chunkMs: 400 });
    await openReaderAtPageOne(page);

    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByTestId('narration-highlight')).toBeVisible();

    // Two chunks on page 1, then AUTO_ADVANCE_DELAY_MS, then the 250ms flip.
    await expect(page.getByTestId('spread-position')).toHaveText('Page 2 of 5');
  });

  test('navigating mid-sentence advances exactly one page — no phantom turn from the abandoned one', async ({
    page,
  }) => {
    // Long chunks, so page 2's own legitimate auto-advance stays far outside the settle
    // window below and cannot be mistaken for the bug this is looking for.
    await installFakeSpeech(page, { chunkMs: 2000 });
    await openReaderAtPageOne(page);

    await page.getByRole('button', { name: 'Play' }).click();

    // Navigate away while the *last* chunk of the page is speaking. That is the only moment
    // the bug can happen: `cancel()` fires `end` on the in-flight utterance, and an `end` on
    // the final chunk is what reads as "page finished". Leaving during an earlier sentence
    // proves nothing, because there is no `onDone` to go stale.
    await expect(page.getByTestId('narration-highlight')).toContainText(PAGE_1_SECOND);

    await page.getByRole('button', { name: 'Next spread' }).click();
    await expect(page.getByTestId('spread-position')).toHaveText('Page 2 of 5');

    // That late `end` lands ~0ms after the new page mounts, and an unguarded one schedules a
    // second turn AUTO_ADVANCE_DELAY_MS later. Page 2 is five chunks long, so its own
    // legitimate advance is ~10s away — anything that moves the reader inside this window
    // came from the page they already left.
    //
    // Two mechanisms keep that from happening (the provider's dead-handle flag and the
    // hook's monotonic runId), and this asserts the user-visible outcome rather than either
    // one: it fails only if both regress. The runId guard is pinned directly, on its own, in
    // `client/src/hooks/__tests__/useNarration.test.tsx`.
    await page.waitForTimeout(1500);
    await expect(
      page.getByTestId('spread-position'),
      'the abandoned page requested a page turn — the stale-utterance guards are not holding',
    ).toHaveText('Page 2 of 5');

    // And the highlight belongs to the page on screen, not the one left behind.
    const highlight = page.getByTestId('narration-highlight');
    await expect(highlight).toBeVisible();
    await expect(highlight).not.toContainText(PAGE_1_FIRST);
  });

  test('Pause holds the highlight where it is; Play resumes from the same sentence', async ({
    page,
  }) => {
    await installFakeSpeech(page, { chunkMs: 1500 });
    await openReaderAtPageOne(page);

    await page.getByRole('button', { name: 'Play' }).click();
    const highlight = page.getByTestId('narration-highlight');
    await expect(highlight).toContainText(PAGE_1_FIRST);

    await page.getByRole('button', { name: 'Pause' }).click();
    // Longer than a chunk: if pause were a no-op the highlight would have moved on by now.
    await page.waitForTimeout(2500);
    await expect(highlight).toContainText(PAGE_1_FIRST);
    await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');

    await page.getByRole('button', { name: 'Play' }).click();
    await expect(highlight).toContainText(PAGE_1_SECOND);
  });

  test('without a speech engine the player is honestly disabled rather than silent', async ({
    page,
  }) => {
    await installNoSpeech(page);
    await page.goto(BOOK_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

    // Not a toast and not a hidden component: a Play button that silently does nothing is
    // worse than an honest disabled one.
    await expect(page.getByText("Read-aloud isn't available in this browser.")).toBeVisible();

    for (const name of ['Play', 'Previous sentence', 'Next sentence', 'Stop reading']) {
      await expect(page.getByRole('button', { name }), `"${name}" should be disabled`).toBeDisabled();
    }
    await expect(page.getByTestId('narration-settings')).toHaveCount(0);

    // The reader itself still works — narration is a capability of the page, not a gate on it.
    await page.getByRole('button', { name: 'Next spread' }).click();
    await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');
  });
});
