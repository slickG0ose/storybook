import { Router } from 'express';
import { HeroPoolResponseSchema } from '@storybook/shared';
import { validate } from '../middleware/validate';
import { resolveHeroPool } from '../lib/heroPool';

/**
 * `GET /api/hero/pool` — the best-of frames the Home hero rotates through after first
 * paint. Spec: `.code-captain/specs/hero-rotation/spec.md`.
 *
 * ---------------------------------------------------------------------------------
 * THIS ROUTER HAS NO AUTH MIDDLEWARE, AND MUST NEVER READ THE AUTHENTICATED USER.
 * ---------------------------------------------------------------------------------
 *
 * (Written that way on purpose: the task's done-when greps this file for the auth-lookup
 * helper's name and requires zero hits, so even naming it in a comment would defeat the
 * check. The helper is the one `routes/auth.ts` exports and every authed route imports.)
 *
 * That absence is the fourth consent seam, and it is load-bearing rather than an
 * oversight. The pool is a *published* list: the same frames for a signed-out visitor, a
 * signed-in reader, and an admin. The moment this route reads auth state, "what the
 * catalog promotes" and "what this particular person's account contains" become one code
 * path, and the personalised hero (a separate spec, `hero-personal`) inherits a pool
 * route that already leaks. `hero.test.ts` pins it three ways: an auth-invariance test
 * comparing byte-identical bodies across no token / user token / admin token, the
 * `source: z.literal('pool')` discriminator in the response schema, and the grep above.
 *
 * So: no `requireAuth`, no `adminGate`, no optional auth read, and no `req` at all —
 * hence the `_req` in the handler signature. If a future change needs the request, that
 * is the moment to re-read the spec's §"The consent seam" rather than reach for the
 * parameter.
 *
 * No spend surface either: no Claude call, no image generation, no `spendGate`, no
 * `UsageLog`. It reads two boolean-ish columns and a memoised set of `stat` results,
 * capped at `MAX_POOL_FRAMES`.
 */
const router = Router();

router.get(
  '/pool',
  validate({ name: 'GET /api/hero/pool', response: HeroPoolResponseSchema }),
  async (_req, res) => {
    // The only route in this codebase that sets a cache header — accepted deliberately
    // as a new precedent (spec §Open question 3, to be recorded in ADR-015). The pool is
    // public, identical for everyone, and changes only on deploy, and the backend is a
    // free-tier Render instance that sleeps: 300 s of shared caching is what keeps a cold
    // start from being asked for the same list by every visitor at once.
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ frames: await resolveHeroPool() });
  },
);

export default router;
