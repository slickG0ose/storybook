import { describe, it, expect } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { parseAllowedOrigins, buildCorsPolicy } from '../cors';

// Mounts the policy on a throwaway app so the assertions are about the headers
// a browser actually receives, not about the shape of the options object.
function appWith(env: NodeJS.ProcessEnv) {
  const app = express();
  app.use(cors(buildCorsPolicy(env).options));
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return app;
}

describe('parseAllowedOrigins', () => {
  it('returns an empty list for unset or blank values', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('  ,  ,')).toEqual([]);
  });

  it('splits, trims, lowercases, and drops trailing slashes', () => {
    expect(parseAllowedOrigins('https://SlickG0ose.github.io/, http://localhost:5173 ')).toEqual([
      'https://slickg0ose.github.io',
      'http://localhost:5173',
    ]);
  });
});

describe('buildCorsPolicy', () => {
  it('is permissive and silent outside production when CORS_ORIGIN is unset', () => {
    const policy = buildCorsPolicy({ NODE_ENV: 'test' });
    expect(policy.allowed).toEqual([]);
    expect(policy.warning).toBeNull();
  });

  it('is permissive but warns in production when CORS_ORIGIN is unset', () => {
    const policy = buildCorsPolicy({ NODE_ENV: 'production' });
    expect(policy.allowed).toEqual([]);
    expect(policy.warning).toMatch(/CORS_ORIGIN is not set/);
  });

  it('does not warn in production once CORS_ORIGIN is set', () => {
    const policy = buildCorsPolicy({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://slickg0ose.github.io',
    });
    expect(policy.allowed).toEqual(['https://slickg0ose.github.io']);
    expect(policy.warning).toBeNull();
  });
});

describe('CORS response headers', () => {
  const prodEnv = { NODE_ENV: 'production', CORS_ORIGIN: 'https://slickg0ose.github.io' };

  it('echoes an allowed origin back', async () => {
    const res = await request(appWith(prodEnv))
      .get('/api/health')
      .set('Origin', 'https://slickg0ose.github.io');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://slickg0ose.github.io');
  });

  it('matches an allowed origin case-insensitively', async () => {
    const res = await request(appWith(prodEnv))
      .get('/api/health')
      .set('Origin', 'https://SlickG0ose.github.io');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('omits the allow-origin header for a disallowed origin', async () => {
    const res = await request(appWith(prodEnv))
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    // The request still completes — CORS is enforced by the browser reading
    // the response, not by the server refusing to serve it. What matters is
    // that the header the browser needs is absent.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a disallowed origin on the preflight too', async () => {
    const res = await request(appWith(prodEnv))
      .options('/api/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves requests with no Origin header — health checks and curl', async () => {
    const res = await request(appWith(prodEnv)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('allows any origin when CORS_ORIGIN is unset', async () => {
    const res = await request(appWith({ NODE_ENV: 'test' }))
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('supports more than one allowed origin', async () => {
    const app = appWith({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://slickg0ose.github.io,https://storybook.example.com',
    });
    for (const origin of ['https://slickg0ose.github.io', 'https://storybook.example.com']) {
      const res = await request(app).get('/api/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });
});
