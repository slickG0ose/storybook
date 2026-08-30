import { API_BASE } from './ports';

/**
 * Fails the run, before a single spec executes, if the database behind it is not
 * hydrated (#127 follow-up).
 *
 * WHY THIS EXISTS. `hero-rotation.spec.ts` needs the demo book seeded with both
 * `is_hero_eligible` and `hero_consent_at`, or `GET /api/hero/pool` returns
 * `{ frames: [] }` and the hero correctly never rotates. The spec said so in its own
 * docblock and still cost a full debugging round: an empty pool surfaces as five
 * `element(s) not found` timeouts, which is indistinguishable from a real rotation
 * regression. A working hero on a green master was reported broken, chased across two
 * worktrees, and only the docblock settled it.
 *
 * A per-assertion hint helps whoever reads the failure. It does not help the person who
 * has not run the suite yet, and it arrives 20 seconds and five red tests late. This
 * check costs one request and speaks before any of that.
 *
 * WHY THE WHOLE SUITE AND NOT JUST ONE SPEC. A hydrated database is already a global
 * precondition here — `home.spec.ts` asserts the catalog renders, the cart and checkout
 * specs need buyable books. The hero pool is simply the strictest form of the same
 * requirement, so it doubles as the canary for all of it.
 *
 * WHY IT DOES NOT HYDRATE FOR YOU. `db:hydrate` is upsert-only and safe to run by hand,
 * but running it as a silent side effect of `npm test` would mutate a developer's local
 * data because they asked to run tests. Reporting the problem and naming the one command
 * that fixes it keeps that decision with the person whose database it is.
 *
 * ORDERING. Playwright starts every `webServer` entry before `globalSetup`, so the API is
 * already up by the time this runs. The retry loop below is not there to wait for boot —
 * it absorbs the case where Express is listening but has not finished its first Prisma
 * connection, and it fails loudly rather than hanging if that assumption ever changes.
 */

/** Long enough for a cold Prisma connection, short enough to not look like a hang. */
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_INTERVAL_MS = 500;

const HYDRATE_COMMAND = 'cd server && npm run db:hydrate';

interface HeroPool {
  frames?: unknown[];
}

async function fetchPool(): Promise<HeroPool | null> {
  try {
    const res = await fetch(`${API_BASE}/api/hero/pool`);
    if (!res.ok) return null;
    return (await res.json()) as HeroPool;
  } catch {
    // Connection refused / socket hang-up while the server settles.
    return null;
  }
}

export default async function globalSetup(): Promise<void> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let pool: HeroPool | null = null;

  while (Date.now() < deadline) {
    pool = await fetchPool();
    if (pool) break;
    await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
  }

  if (!pool) {
    throw new Error(
      `e2e preflight: GET ${API_BASE}/api/hero/pool never answered within ` +
        `${PROBE_TIMEOUT_MS / 1000}s.\n\n` +
        `The API server did not come up, or it is not the server this suite thinks it is. ` +
        `If another checkout owns the default ports, run with the documented overrides ` +
        `(see e2e/ports.ts):\n\n` +
        `    API_PORT=3011 CLIENT_PORT=5183 PREVIEW_PORT=4183 npx playwright test\n`,
    );
  }

  const frames = Array.isArray(pool.frames) ? pool.frames : [];
  if (frames.length === 0) {
    throw new Error(
      `e2e preflight: the hero pool is empty — the database behind this run is not hydrated.\n\n` +
        `    ${HYDRATE_COMMAND}\n\n` +
        `That command is upsert-only and safe to re-run. Without it, hero-rotation.spec.ts ` +
        `fails with five "element(s) not found" timeouts that look exactly like a rotation ` +
        `regression, and any spec needing a seeded catalog is on thin ice too.\n\n` +
        `A fresh clone and a new agent worktree both start out this way — worktree-setup ` +
        `copies dev.db from the main checkout, so an un-hydrated one propagates.\n`,
    );
  }
}
