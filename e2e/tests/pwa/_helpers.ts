import { expect, type Page } from '@playwright/test';

/**
 * Service-worker lifecycle helpers for the `pwa` project (against `vite preview` on :4173).
 *
 * Extracted from install.spec.ts when a second pwa spec needed the same sequence. The
 * ordering below is load-bearing and easy to get wrong, which is why it lives in one place.
 */

/**
 * Waits until a worker is *activated* — i.e. install, and therefore precaching, finished.
 *
 * `expect.poll` + `page.evaluate` rather than `page.waitForFunction`: waitForFunction does
 * not await a promise-returning predicate, so an `async () => ...` body there resolves
 * truthy on the very first poll and the wait silently becomes a no-op. `page.evaluate`
 * does await.
 */
export async function waitForActiveWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return reg?.active?.state ?? null;
        }),
      { timeout: 20_000 },
    )
    .toBe('activated');
}

/**
 * Waits until this client is under the worker's control.
 *
 * `registerType: 'prompt'` emits neither `skipWaiting` nor `clientsClaim`, so the page
 * that registered the worker is never controlled by it. One reload **while still online**
 * is what claims the client — cut the network before that reload and the document request
 * goes to a dead server instead of the precache.
 */
export async function waitForController(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 10_000,
    })
    .toBe(true);
}
