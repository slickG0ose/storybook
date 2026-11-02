import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import authRouter from '../auth';
import {
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW_MS,
  MAX_TRACKED_KEYS,
  authRateLimit,
  clientKey,
  resetAuthRateLimits,
  resolveTrustProxyHops,
  trackedKeyCount,
} from '../../middleware/authRateLimit';

/**
 * Pins the brute-force limit on /login and /register (CodeQL alert #7, ADR-030).
 *
 * These are the evidence a dismissal of alert #7 would rest on: the query recognises
 * rate limiters by library name, so it cannot see this one however correct it is.
 */

const EMAIL = 'limited@example.com';
const PASSWORD = 'pw-test-1234';

function failLogin(app: Express, forwardedFor?: string) {
  const req = request(app).post('/api/auth/login');
  if (forwardedFor) req.set('X-Forwarded-For', forwardedFor);
  return req.send({ email: EMAIL, password: 'not-the-password' });
}

async function exhaustLoginBudget(app: Express) {
  for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
    const res = await failLogin(app);
    expect(res.status).toBe(401);
  }
}

describe('auth rate limiting', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetAuthRateLimits();
    await allowEmail(EMAIL);
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, name: 'Limited', password: PASSWORD });
    expect(reg.status).toBe(201);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('POST /api/auth/login', () => {
    it('returns 429 with the error envelope and Retry-After once the budget is spent', async () => {
      await exhaustLoginBudget(app);

      const res = await failLogin(app);

      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({
        error: expect.any(String),
        retryAfterSeconds: expect.any(Number),
      });
      expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(res.body.retryAfterSeconds).toBeLessThanOrEqual(AUTH_RATE_LIMIT_WINDOW_MS / 1000);
      expect(res.headers['retry-after']).toBe(String(res.body.retryAfterSeconds));
    });

    it('blocks the correct password too, so a 429 tells a guesser nothing', async () => {
      await exhaustLoginBudget(app);

      const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(429);
      expect(res.body).not.toHaveProperty('token');
    });

    it('does not spend budget on successful logins', async () => {
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 2; i++) {
        const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
        expect(res.status).toBe(200);
      }

      expect((await failLogin(app)).status).toBe(401);
    });

    it('does not let a successful login clear earlier failures', async () => {
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX - 1; i++) {
        await failLogin(app);
      }
      const ok = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
      expect(ok.status).toBe(200);

      expect((await failLogin(app)).status).toBe(401);
      expect((await failLogin(app)).status).toBe(429);
    });

    it('holds under a parallel burst, where no failure has been recorded yet', async () => {
      const statuses = (
        await Promise.all(Array.from({ length: AUTH_RATE_LIMIT_MAX + 5 }, () => failLogin(app)))
      ).map((res) => res.status);

      expect(statuses.filter((status) => status === 401)).toHaveLength(AUTH_RATE_LIMIT_MAX);
      expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    });

    it('slides: an attempt frees up only when that attempt ages out', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.now();

      for (let i = 0; i < AUTH_RATE_LIMIT_MAX - 1; i++) {
        await failLogin(app);
      }
      vi.setSystemTime(start + AUTH_RATE_LIMIT_WINDOW_MS - 1000);
      await failLogin(app);
      expect((await failLogin(app)).status).toBe(429);

      // Past the first nine, not the tenth. A fixed window would hand back all ten here.
      vi.setSystemTime(start + AUTH_RATE_LIMIT_WINDOW_MS + 1);
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX - 1; i++) {
        expect((await failLogin(app)).status).toBe(401);
      }
      expect((await failLogin(app)).status).toBe(429);
    });
  });

  describe('POST /api/auth/register', () => {
    it('returns 429 after repeated failures, with the same envelope', async () => {
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
        const res = await request(app)
          .post('/api/auth/register')
          .send({ email: `probe${i}@example.com`, name: 'Probe', password: PASSWORD });
        expect(res.status).toBe(403);
      }

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'probe-last@example.com', name: 'Probe', password: PASSWORD });

      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({
        error: expect.any(String),
        retryAfterSeconds: expect.any(Number),
      });
    });

    it('has its own budget, so failed signups cannot block logins', async () => {
      for (let i = 0; i <= AUTH_RATE_LIMIT_MAX; i++) {
        await request(app)
          .post('/api/auth/register')
          .send({ email: `probe${i}@example.com`, name: 'Probe', password: PASSWORD });
      }

      const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
      expect(res.status).toBe(200);
    });
  });

  describe('behind a proxy (trust proxy = 1)', () => {
    let proxied: Express;

    beforeAll(() => {
      proxied = express();
      proxied.set('trust proxy', 1);
      proxied.use(express.json());
      proxied.use('/api/auth', authRouter);
    });

    it('keeps separate budgets for separate clients', async () => {
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
        await failLogin(proxied, '203.0.113.1');
      }

      expect((await failLogin(proxied, '203.0.113.1')).status).toBe(429);
      expect((await failLogin(proxied, '203.0.113.2')).status).toBe(401);
    });

    it('ignores left-most X-Forwarded-For entries, which the client controls', async () => {
      for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
        await failLogin(proxied, `198.51.100.${i}, 203.0.113.1`);
      }

      expect((await failLogin(proxied, '198.51.100.200, 203.0.113.1')).status).toBe(429);
    });
  });

  describe('memory bound', () => {
    it('evicts rather than growing past MAX_TRACKED_KEYS', () => {
      const middleware = authRateLimit('eviction-test');
      const res = { once: () => undefined } as unknown as express.Response;
      const next = vi.fn();

      for (let i = 0; i < MAX_TRACKED_KEYS + 100; i++) {
        const octets = [i >>> 16, (i >>> 8) & 255, i & 255].join('.');
        middleware({ ip: `10.${octets}` } as express.Request, res, next);
      }

      expect(trackedKeyCount()).toBeLessThanOrEqual(MAX_TRACKED_KEYS);
      expect(next).toHaveBeenCalledTimes(MAX_TRACKED_KEYS + 100);
    });

    it('drops expired keys without waiting for the cap', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const middleware = authRateLimit('expiry-test');
      const res = { once: () => undefined } as unknown as express.Response;
      resetAuthRateLimits();

      middleware({ ip: '10.0.0.1' } as express.Request, res, vi.fn());
      middleware({ ip: '10.0.0.2' } as express.Request, res, vi.fn());
      vi.setSystemTime(Date.now() + AUTH_RATE_LIMIT_WINDOW_MS);
      middleware({ ip: '10.0.0.3' } as express.Request, res, vi.fn());

      expect(trackedKeyCount()).toBe(1);
    });
  });

  describe('clientKey()', () => {
    it('leaves IPv4 alone and unwraps IPv4-mapped IPv6', () => {
      expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
      expect(clientKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    });

    it('puts every address in an IPv6 /64 in one budget', () => {
      const key = clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
      expect(key).toBe('2001:db8:1:2::/64');
      expect(clientKey('2001:db8:1:2::1')).toBe(key);
      expect(clientKey('2001:DB8:1:2:0:0:0:ffff')).toBe(key);
      expect(clientKey('2001:0db8:0001:0002::9')).toBe(key);
      expect(clientKey('2001:db8:1:3::1')).not.toBe(key);
    });

    it('handles compressed and scoped forms', () => {
      expect(clientKey('::1')).toBe('0:0:0:0::/64');
      expect(clientKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
      expect(clientKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    });

    it('gives a missing address one shared budget rather than none', () => {
      expect(clientKey(undefined)).toBe('unknown');
    });
  });

  describe('resolveTrustProxyHops()', () => {
    it('defaults to one hop in production and none elsewhere', () => {
      expect(resolveTrustProxyHops({ NODE_ENV: 'production' })).toBe(1);
      expect(resolveTrustProxyHops({ NODE_ENV: 'test' })).toBe(0);
      expect(resolveTrustProxyHops({})).toBe(0);
    });

    it('honours an explicit count', () => {
      expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '3' })).toBe(3);
      expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' })).toBe(0);
    });

    it('treats a malformed count as the default, so a typo cannot trust the whole header', () => {
      for (const raw of ['', ' ', 'true', '-1', '1.5', 'loopback']) {
        expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: raw })).toBe(1);
      }
    });
  });
});
