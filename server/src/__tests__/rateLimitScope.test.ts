import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertSingleInstanceAssumption } from '../middleware/rateLimit';

/**
 * Guards the single-instance assumption that `middleware/rateLimit.ts` is built on
 * (ADR-018).
 *
 * WHY THIS EXISTS. The limiter keeps its counters in a Map in one process. That is a
 * correct and deliberate choice while Render runs one box, and it becomes wrong with no
 * error, no log, and no failing test the moment a second instance appears — the
 * effective limit just quietly multiplies by the instance count. The thing that
 * invalidates the assumption (a scaling change) is not the thing that would surface it.
 *
 * TWO SURFACES, DELIBERATELY, because neither covers the other's path:
 *
 *   1. `render.yaml` is the declared config and lives in this repo, so a scale-up
 *      committed here fails in CI on the PR that does it. That is the loud one.
 *   2. `assertSingleInstanceAssumption()` covers scaling done in the Render dashboard,
 *      which never touches this repo — but only if the operator sets
 *      RATE_LIMIT_INSTANCE_COUNT. An operator who scales without setting it still gets
 *      no signal. That gap is real and named rather than papered over.
 *
 * This does NOT assert anything about brute-force protection on `POST /api/auth/login`
 * (CodeQL alert #7). That route is unauthenticated, so this middleware cannot be mounted
 * on it at all — see the rateLimit.ts header and ADR-018. Tracked in #148.
 */

const RENDER_YAML = join(import.meta.dirname, '..', '..', '..', 'render.yaml');

describe('rate limiting: single-instance assumption', () => {
  describe('render.yaml', () => {
    it('does not declare more than one web-service instance', () => {
      const yaml = readFileSync(RENDER_YAML, 'utf-8');
      const declared = /^\s*numInstances:\s*(\d+)\s*$/m.exec(yaml);
      const count = declared === null ? 1 : Number.parseInt(declared[1], 10);

      expect(
        count,
        'render.yaml now declares numInstances > 1, but middleware/rateLimit.ts keeps its ' +
          'counters in-process. Each instance would get its own budget and every rateLimit() ' +
          'max would be multiplied by the instance count. Move the counter to a shared store ' +
          'before scaling, then update this test and ADR-018.',
      ).toBe(1);
    });

    it('still pins the assumption to a service this test can actually see', () => {
      // Guards the guard: if the web service is renamed or removed, the regex above
      // starts passing vacuously against a file that no longer describes the deploy.
      const yaml = readFileSync(RENDER_YAML, 'utf-8');
      expect(yaml).toContain('type: web');
      expect(yaml).toContain('name: storybook-server');
    });
  });

  describe('assertSingleInstanceAssumption()', () => {
    it('is silent when the count is unset, empty, or one', () => {
      const log = vi.fn();
      for (const env of [{}, { RATE_LIMIT_INSTANCE_COUNT: '' }, { RATE_LIMIT_INSTANCE_COUNT: '1' }]) {
        expect(() => assertSingleInstanceAssumption(env, log)).not.toThrow();
      }
      expect(log).not.toHaveBeenCalled();
    });

    it('warns outside production when more than one instance is declared', () => {
      const log = vi.fn();
      assertSingleInstanceAssumption({ RATE_LIMIT_INSTANCE_COUNT: '3' }, log);

      expect(log).toHaveBeenCalledTimes(1);
      const [message] = log.mock.calls[0] as [string];
      // The multiplier is the whole point of the message — a warning that does not say
      // "3x" leaves the reader to work out why they should care.
      expect(message).toContain('3x');
      expect(message).toContain('ADR-018');
    });

    it('throws in production rather than serving a silently weaker limit', () => {
      expect(() =>
        assertSingleInstanceAssumption({ RATE_LIMIT_INSTANCE_COUNT: '2', NODE_ENV: 'production' }),
      ).toThrow(/per-instance/);
    });

    it('treats a malformed count as one, so a typo cannot disable the guard', () => {
      // Same posture as spend.ts, where a malformed limit falls back to the default
      // rather than to Infinity.
      const log = vi.fn();
      for (const raw of ['abc', '-4', '0', 'two']) {
        expect(() =>
          assertSingleInstanceAssumption({ RATE_LIMIT_INSTANCE_COUNT: raw, NODE_ENV: 'production' }, log),
        ).not.toThrow();
      }
      expect(log).not.toHaveBeenCalled();
    });
  });
});
