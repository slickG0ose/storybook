import { defineConfig } from '@playwright/test';
import { API_BASE, API_PORT, CLIENT_BASE, CLIENT_PORT, PREVIEW_BASE, PREVIEW_PORT } from './ports';

export default defineConfig({
  testDir: './tests',
  // Refuses to start the suite against an un-hydrated database, naming the one command
  // that fixes it. See the docblock in global-setup.ts for why this is worth a preflight
  // request rather than a comment in the spec that needs it.
  globalSetup: './global-setup.ts',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 3, not 1, and not `undefined`. The suite is `fullyParallel`, so this parallelises
  // per test, not per file: 147 tests went 6.3m -> 1.1m locally at 3 workers, twice,
  // with no flake. Capped at 3 rather than left to Playwright's CPU heuristic because
  // ubuntu-latest gives 4 vCPU and the API server plus the Vite dev server are
  // already using some of them — `undefined` would oversubscribe the runner and trade
  // the win back for timeouts.
  //
  // The ceiling on raising this further is server state, not CPU. Browser state is
  // isolated per test (localStorage cleared in beforeEach, see docs/conventions/
  // testing.md), but all workers share one Express instance and one dev.db, and
  // nothing resets the DB between tests. Specs that mutate shared rows — admin
  // soft-delete/restore, publish/unpublish, illustration + version history — stay
  // collision-free today because they generate unique data per run. Adding a spec
  // that mutates a *seeded* row is what would break this; mark that one
  // `test.describe.configure({ mode: 'serial' })` rather than dropping workers back.
  workers: process.env.CI ? 3 : undefined,
  reporter: 'html',

  use: {
    baseURL: CLIENT_BASE,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      // The desktop suite is unchanged. Scoping it away from tests/mobile (and the
      // future tests/pwa) keeps the mobile specs from being run a third time at the
      // default desktop viewport, where their assertions would be meaningless.
      testIgnore: /tests\/(mobile|pwa)\//,
    },
    // testMatch must end in .spec.ts, not just match tests/mobile/: a bare directory
    // regex replaces Playwright's default file filter and pulls _helpers.ts in as a test
    // file, which Playwright rejects ("test file should not import test file").
    // Chromium at mobile viewports rather than devices['iPhone 13']: that descriptor's
    // defaultBrowserType is 'webkit', and .github/workflows/pr-ci.yml installs Chromium
    // only. WebKit coverage is deliberately deferred (spec Alternatives -> mobile e2e
    // device matrix) and should be paired with the deploy restoration in #77.
    {
      name: 'mobile-pixel', // Pixel 5 / iPhone 13 class
      use: {
        browserName: 'chromium',
        viewport: { width: 393, height: 851 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /tests\/mobile\/.*\.spec\.ts$/,
    },
    {
      name: 'mobile-small', // the tight real-world case
      use: {
        browserName: 'chromium',
        viewport: { width: 360, height: 740 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /tests\/mobile\/.*\.spec\.ts$/,
    },
    // The only project that talks to a production build. A service worker on :5173 would
    // serve the other three projects stale precached assets, so pwa.config.ts sets
    // devOptions.enabled=false and this project points at `vite preview` on :4173
    // instead. Same .spec.ts narrowing as the mobile projects, for the same reason.
    {
      name: 'pwa',
      use: { browserName: 'chromium', baseURL: `${PREVIEW_BASE}/` },
      testMatch: /tests\/pwa\/.*\.spec\.ts$/,
    },
  ],

  webServer: [
    {
      // Watch mode locally, plain run in CI. There is nothing to watch on a CI runner —
      // the checkout is immutable for the life of the job — and a `tsx watch` restart
      // drops every in-flight connection, which surfaces as `socket hang up` in whichever
      // request happened to be open. That is what #166 caught: the failure landed in a
      // spec's `afterAll` cleanup, so Playwright attributed it to the last test in the
      // block and named a spec whose body had already passed. Three workers did not cause
      // it; they only widened the window to land inside a restart. See #166.
      command: process.env.CI ? 'npx tsx src/index.ts' : 'npx tsx watch src/index.ts',
      cwd: '../server',
      env: { PORT: API_PORT },
      url: `${API_BASE}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: 'npx vite --host',
      cwd: '../client',
      // Vite's config reads these three names; see client/vite.config.ts.
      env: { API_PORT, CLIENT_PORT, PREVIEW_PORT },
      url: CLIENT_BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    // Production build + preview, for the `pwa` project only. A cold `vite build` plus
    // the Workbox generation step takes far longer than the 15s the dev servers need, so
    // this entry carries its own timeout rather than inheriting the default.
    {
      command: `npm run build && npx vite preview --port ${PREVIEW_PORT} --strictPort`,
      cwd: '../client',
      env: { API_PORT, CLIENT_PORT, PREVIEW_PORT },
      url: `${PREVIEW_BASE}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
