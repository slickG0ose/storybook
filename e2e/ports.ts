/**
 * The ports the e2e suite talks to, in one place (#130).
 *
 * Every value defaults to the port that was hardcoded before, so CI, `npm run dev`, and
 * every existing workflow behave exactly as they did. Override them to run the suite
 * against a checkout other than the one whose dev servers already own 3001/5173/4173 —
 * without this, `reuseExistingServer: !process.env.CI` silently drives the *other*
 * checkout's code and reports its failures as yours.
 *
 *   API_PORT=3011 CLIENT_PORT=5183 PREVIEW_PORT=4183 npx playwright test
 *
 * playwright.config.ts forwards these to the servers it spawns: `PORT` to the Express
 * server, and `API_PORT` / `CLIENT_PORT` / `PREVIEW_PORT` to Vite, whose config reads the
 * same three names.
 */
export const API_PORT = process.env.API_PORT ?? '3001';
export const CLIENT_PORT = process.env.CLIENT_PORT ?? '5173';
export const PREVIEW_PORT = process.env.PREVIEW_PORT ?? '4173';

/** Origin of the Express API, for the setup calls specs make outside the browser. */
export const API_BASE = `http://localhost:${API_PORT}`;
/** Origin of the Vite dev server — Playwright's `baseURL` for all non-pwa projects. */
export const CLIENT_BASE = `http://localhost:${CLIENT_PORT}`;
/** Origin of `vite preview`, i.e. the production build the `pwa` project drives. */
export const PREVIEW_BASE = `http://localhost:${PREVIEW_PORT}`;
