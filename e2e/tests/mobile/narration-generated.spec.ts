import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Request, type Route } from '@playwright/test';
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme, PRIMARY_TAP_MIN } from './_helpers';
import { installFakeSpeech } from '../_speech';
import { installFakeMedia } from '../_media';
import { API_BASE } from '../../ports';
// Relative source import, not the `@storybook/shared` package: `e2e/` has no dependency on
// the workspace package (see `_editPublished.ts`). It is imported rather than re-declared
// because the stubbed segment offsets must equal the client's chunk offsets *exactly* —
// the provider rejects a mismatch as `synthesis-failed` — and a hand-copied splitter would
// be a second implementation of the one function both sides are required to share.
import { narrationTextFor, splitIntoUtterances, type NarratableBook } from '../../../shared/src/narration';

/**
 * Read-aloud with a **generated** voice (Kokoro via fal), at mobile width, under both mobile
 * viewport projects and in both themes. Spec: `.code-captain/specs/generated-narration/`.
 *
 * **Done-criterion #2 (ADR-009): this spec discharges the *correctness* half only** — both
 * themes at a mobile viewport, no horizontal overflow, 44px tap targets, and the player
 * never `position: fixed`, with the AI disclosure, preparing state, and fallback notice on
 * screen. Whether those lines *look* right (colour, weight, spacing under the book frame)
 * is the aesthetic half, still a human's call, and is not claimed here.
 *
 * **No live fal call, and no real generation.** All three narration routes are stubbed with
 * `page.route`: voices, the free cached-clip GET (always `missing`), and the paid POST
 * (`ready`, segment URLs pointing at a committed 100 ms silent WAV). Sign-in is a seeded
 * `storybook-auth` plus a stubbed `/api/auth/me`, so no user row is written. Playback is
 * the `_media.ts` fake and the device fallback is the `_speech.ts` fake, so what is proven
 * is the state machine and the layout — never audibility.
 */

/** Seeded 5-page book — the same fixture the device read-aloud specs read. */
const BOOK_ID = 'luna-star-garden';
const BOOK_PATH = `/book/${BOOK_ID}`;

const PLAYER_CONTROLS =
  '[data-testid="narration-player"] button, [data-testid="narration-player"] select';

const FAKE_USER = {
  id: 'e2e-narration-user',
  email: 'narration-e2e@example.com',
  name: 'Narration Tester',
  token: 'e2e-narration-token',
};

/** Copy from `FALLBACK_NOTICES` in `client/src/hooks/useNarration.ts`. */
const QUOTA_NOTICE = 'AI voice is done for today. Using device voice.';

const SILENCE_WAV = readFileSync(
  path.join(__dirname, '../../fixtures/silence-100ms.wav'),
);

/** `GET|POST /api/books/:id/narration` — and not `GET /api/books/:id` itself. */
const isNarrationRoute = (url: URL): boolean => /^\/api\/books\/[^/]+\/narration$/.test(url.pathname);

type Slot = 'cover' | 'end' | number;

/** The stub's `ready` body for a slot, with offsets from the same splitter the client uses. */
function readyBody(book: NarratableBook, slot: Slot): unknown {
  const text = narrationTextFor(book, slot);
  if (text === null) throw new Error(`book ${BOOK_ID} has no slot ${String(slot)}`);
  const key = typeof slot === 'number' ? `p${slot}` : slot;
  return {
    status: 'ready',
    voiceId: 'af_heart',
    slot,
    textHash: 'e2e-stub',
    cached: false,
    segments: splitIntoUtterances(text).map((chunk, index) => ({
      index,
      start: chunk.start,
      end: chunk.end,
      url: `/illustrations/${BOOK_ID}/narration/${key}-af_heart-e2estub-${index}.wav`,
      durationMs: 100,
    })),
  };
}

interface NarrationStubs {
  /** Every narration GET/POST the page made, in order. */
  calls: { method: string; slot: string | null }[];
  posts(): number;
  /** Client-side contract breaks seen on the paid route (a text field, a missing bearer). */
  violations: string[];
  /** Resolves the held POST, if `holdFirstPost` was set. */
  releaseFirstPost(): void;
  /**
   * Starts a theme pass: forgets recorded calls and re-holds the next POST. The routes
   * themselves stay installed for the whole test, so `forEachTheme`'s own reload is the
   * only navigation per pass (a second reload raced it as `net::ERR_ABORTED`).
   */
  rearm(): void;
}

interface StubOptions {
  voicesAvailable?: boolean;
  /** HTTP status for every POST. 200 serves the `ready` body. */
  postStatus?: 200 | 429;
  /** Hold the first POST until `releaseFirstPost()`, so the preparing state is observable. */
  holdFirstPost?: boolean;
}

async function stubNarration(page: Page, book: NarratableBook, opts: StubOptions = {}): Promise<NarrationStubs> {
  const calls: NarrationStubs['calls'] = [];
  const violations: string[] = [];
  let release: () => void = () => {};
  let held: Promise<void> = Promise.resolve();
  let holding = false;
  const arm = (): void => {
    calls.length = 0;
    violations.length = 0;
    release();
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    holding = opts.holdFirstPost ?? false;
  };
  arm();

  await page.route('**/api/narration/voices', (route) =>
    route.fulfill({
      json: {
        available: opts.voicesAvailable ?? true,
        voices: [
          { id: 'af_heart', label: 'Heart', description: 'Warm storyteller', gender: 'female' },
          { id: 'am_michael', label: 'Michael', description: 'Calm and steady', gender: 'male' },
        ],
      },
    }),
  );

  await page.route(isNarrationRoute, async (route: Route, request: Request) => {
    if (request.method() === 'GET') {
      calls.push({ method: 'GET', slot: new URL(request.url()).searchParams.get('slot') });
      return route.fulfill({ json: { status: 'missing' } });
    }

    const body = request.postDataJSON() as { voiceId: string; slot: Slot } & Record<string, unknown>;
    calls.push({ method: 'POST', slot: String(body.slot) });
    // The paid route takes no text and bills the bearer — the two invariants the client
    // owns on this request (spec §Constraints, "no client text on paid routes").
    const keys = Object.keys(body).sort().join(',');
    if (keys !== 'slot,voiceId') violations.push(`POST body carried [${keys}], expected [slot,voiceId]`);
    const auth = request.headers()['authorization'];
    if (auth !== `Bearer ${FAKE_USER.token}`) violations.push(`POST Authorization was ${String(auth)}`);

    if (holding) {
      holding = false;
      await held;
    }
    if ((opts.postStatus ?? 200) === 429) {
      return route.fulfill({
        status: 429,
        headers: { 'Retry-After': '3600' },
        json: { error: 'Daily narration limit reached' },
      });
    }
    return route.fulfill({ json: readyBody(book, body.slot) });
  });

  await page.route('**/illustrations/*/narration/*.wav', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: SILENCE_WAV }),
  );

  return {
    calls,
    posts: () => calls.filter((call) => call.method === 'POST').length,
    violations,
    releaseFirstPost: () => release(),
    rearm: arm,
  };
}

/** Seeds a signed-in session without touching the database: `/api/auth/me` is stubbed. */
async function signIn(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: { id: FAKE_USER.id, email: FAKE_USER.email, name: FAKE_USER.name, role: 'user' },
    }),
  );
  await page.evaluate((user) => localStorage.setItem('storybook-auth', JSON.stringify(user)), FAKE_USER);
}

/** The layout half shared by every pass: overflow, tap targets, and the no-`fixed` invariant. */
async function expectPlayerLayout(page: Page, theme: string): Promise<void> {
  const player = page.getByTestId('narration-player');
  const position = await player.evaluate((el) => getComputedStyle(el).position);
  expect(
    position,
    `[${theme}] the narration player is bottom-fixed; UpdateToast must remain the only fixed surface`,
  ).not.toBe('fixed');
  await expectNoHorizontalOverflow(page);
  await expectTapTargets(page, PLAYER_CONTROLS, PRIMARY_TAP_MIN);
}

let book: NarratableBook;

test.describe('Read-aloud with a generated voice on mobile', () => {
  // Two themes, each reading the cover and part of page 1 in real (fake-clock) time.
  test.setTimeout(120_000);

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/books/${BOOK_ID}`);
    expect(res.ok(), `seeded book ${BOOK_ID} is missing — run db:hydrate`).toBeTruthy();
    book = (await res.json()) as NarratableBook;
  });

  test.beforeEach(async ({ page }) => {
    await installFakeSpeech(page, { chunkMs: 250 });
    await installFakeMedia(page, { clipMs: 800 });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('prepares, highlights clip by clip, and turns the page, in either theme', async ({ page }) => {
    await signIn(page);
    const stubs = await stubNarration(page, book, { holdFirstPost: true });
    await page.goto(BOOK_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        // The provider's in-memory clip cache died with forEachTheme's reload; re-hold the
        // next POST, which is what makes the preparing state observable.
        stubs.rearm();
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

        await expect(page.getByTestId('spread-position')).toHaveText('Cover');

        // The default ladder's rung 0 is `generated:af_heart`, and it is disclosed as a
        // visible line in the player — not behind the settings disclosure.
        const disclosure = page.getByTestId('narration-ai-disclosure');
        await expect(disclosure, `[${theme}] no AI disclosure with the default generated voice`).toBeVisible();
        await expect(disclosure).toHaveText('AI-generated voice.');
        await expectPlayerLayout(page, theme);

        await page.getByRole('button', { name: 'Play' }).click();

        // The cover's POST is held: the spinner shows, and the button's accessible name
        // is already "Pause" so a slow first clip can still be stopped.
        await expect(page.getByTestId('narration-preparing'), `[${theme}] no preparing state`).toBeVisible();
        await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
        await expectPlayerLayout(page, theme);
        stubs.releaseFirstPost();
        await expect(page.getByTestId('narration-preparing')).toHaveCount(0);

        // Two cover clips, then the turn. Page 1 was prefetched while the cover played.
        await expect(
          page.getByTestId('spread-position'),
          `[${theme}] auto-advance did not turn from the cover to page 1`,
        ).toHaveText('Page 1 of 5');

        const [first, second] = splitIntoUtterances(narrationTextFor(book, 1) ?? '');
        const highlight = page.getByTestId('narration-highlight');
        await expect(highlight, `[${theme}] page 1 never highlighted its first clip`).toHaveText(first!.text);
        await expect(highlight, `[${theme}] the highlight did not advance to clip 2`).toHaveText(second!.text);
        await expect(highlight).toHaveCount(1);

        await page.getByRole('button', { name: 'Stop reading' }).click();

        // Generated all the way: no fallback notice, and no text ever left the client.
        await expect(page.getByTestId('narration-notice')).toHaveCount(0);
        expect(stubs.calls.filter((c) => c.method === 'POST').map((c) => c.slot)).toEqual(
          expect.arrayContaining(['cover', '1']),
        );
        expect(stubs.violations, `[${theme}] the paid route saw a client contract break`).toEqual([]);
        await expectPlayerLayout(page, theme);
      });
    });
  });

  test('offers only the AI voices, Heart by default over a saved device voice, in either theme', async ({
    page,
  }) => {
    // A device voice saved before the picker went AI-only (2026-11-09). It must neither be
    // listed nor win: the effective voice is Heart.
    await page.evaluate(() =>
      localStorage.setItem(
        'storybook-narration',
        JSON.stringify({ voiceURI: 'urn:fake:daniel', rate: 1, autoAdvance: true }),
      ),
    );
    await stubNarration(page, book);
    await page.goto(BOOK_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        await expect(
          page.getByTestId('narration-ai-disclosure'),
          `[${theme}] a saved device voice won over the AI default`,
        ).toBeVisible();

        await page.getByTestId('narration-settings').locator('summary').click();
        const voice = page.getByRole('combobox', { name: 'Voice', exact: true });
        await expect(voice).toBeVisible();
        await expect(voice).toHaveValue('generated:af_heart');
        await expect(voice.locator('optgroup')).toHaveCount(0);
        await expect(voice.locator('option')).toHaveText([
          'Heart — Warm storyteller',
          'Michael — Calm and steady',
        ]);
        // The panel is open, so the voice select is measured as a tap target too.
        await expectPlayerLayout(page, theme);

        await voice.selectOption('generated:am_michael');
        await expect(voice).toHaveValue('generated:am_michael');
        await expect(page.getByTestId('narration-ai-disclosure')).toBeVisible();
        // Reset for the next theme pass, which reloads with whatever was persisted.
        await voice.selectOption('generated:af_heart');
      });
    });
  });

  test('falls back to the device voice on a quota denial and stops asking, in either theme', async ({
    page,
  }) => {
    await signIn(page);
    const stubs = await stubNarration(page, book, { postStatus: 429 });
    await page.goto(BOOK_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        // The reload reset the session's quota stickiness along with everything else.
        stubs.rearm();
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
        await expect(page.getByTestId('narration-ai-disclosure')).toBeVisible();

        await page.getByRole('button', { name: 'Play' }).click();

        const notice = page.getByTestId('narration-notice');
        await expect(notice, `[${theme}] no fallback notice after a 429`).toHaveText(QUOTA_NOTICE);

        // The device fake reads the cover and turns the page; page 1 is read on the
        // device too — the highlight proves playback, the POST count proves stickiness.
        await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');
        await expect(
          page.getByTestId('narration-highlight'),
          `[${theme}] page 1 did not play on the device voice after the fallback`,
        ).toBeVisible();
        await expect(notice).toHaveText(QUOTA_NOTICE);
        expect(stubs.posts(), `[${theme}] a quota denial must not be retried on the next page`).toBe(1);

        await expectPlayerLayout(page, theme);
        await page.getByRole('button', { name: 'Stop reading' }).click();
        expect(stubs.posts()).toBe(1);
        expect(stubs.violations).toEqual([]);
      });
    });
  });

  test('leaves the device flow unchanged when generation is unavailable, in either theme', async ({
    page,
  }) => {
    const stubs = await stubNarration(page, book, { voicesAvailable: false });
    let voicesCalls = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/narration/voices')) voicesCalls += 1;
    });
    await page.goto(BOOK_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Luna and the Star Garden');

    await forEachTheme(page, async (theme) => {
      await test.step(`${theme} mode`, async () => {
        stubs.rearm();
        // The voices route was asked (and said no) — this is the generation-unavailable
        // path, not a build that never wired the generated provider.
        await expect.poll(() => voicesCalls, `[${theme}] the voices route was never called`).toBeGreaterThan(0);

        await page.getByRole('button', { name: 'Next spread' }).click();
        await expect(page.getByTestId('spread-position')).toHaveText('Page 1 of 5');
        await page.getByRole('button', { name: 'Play' }).click();

        await expect(page.getByTestId('narration-highlight')).toBeVisible();
        await expect(page.getByTestId('spread-position')).toHaveText('Page 2 of 5');

        await expect(page.getByTestId('narration-ai-disclosure')).toHaveCount(0);
        await expect(page.getByTestId('narration-notice')).toHaveCount(0);
        await expect(page.getByTestId('narration-preparing')).toHaveCount(0);
        expect(stubs.calls, `[${theme}] a narration request was made with generation unavailable`).toEqual([]);

        await expectPlayerLayout(page, theme);
        await page.getByRole('button', { name: 'Stop reading' }).click();

        // No AI voices to pick, and device voices are never listed: no voice picker at all.
        // The rest of the settings panel stays.
        await page.getByTestId('narration-settings').locator('summary').click();
        await expect(page.getByRole('combobox', { name: 'Speed', exact: true })).toBeVisible();
        await expect(
          page.getByRole('combobox', { name: 'Voice', exact: true }),
          `[${theme}] a voice picker rendered with no AI voices available`,
        ).toHaveCount(0);
        await expectPlayerLayout(page, theme);
      });
    });
  });
});
