import { defineConfig } from '@playwright/test';
import { API_BASE, API_PORT, CLIENT_BASE, CLIENT_PORT, PREVIEW_BASE, PREVIEW_PORT } from './ports';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
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
      command: 'npx tsx watch src/index.ts',
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
