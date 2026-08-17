/**
 * Stand-in for `virtual:pwa-register/react` under Vitest.
 *
 * The virtual module only exists once vite-plugin-pwa is in the plugin chain, and
 * `vitest.config.ts` deliberately does not mount it (a service worker has no business in
 * jsdom). Without a resolvable target, `vi.mock('virtual:pwa-register/react', ...)` fails
 * at resolution rather than mocking, so `vitest.config.ts` aliases the specifier here.
 *
 * The inert default keeps any test that happens to render `<UpdateToast />` from
 * exploding; UpdateToast.test.tsx replaces it with `vi.mock` to drive the states.
 */
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (v: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (v: boolean) => void],
    updateServiceWorker: async () => {},
  }
}
