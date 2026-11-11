import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { allowEmail, resetDatabase } from '../../__tests__/setup';
import authRouter from '../../routes/auth';
import booksRouter from '../../routes/books';
import { securityHeaders } from '../securityHeaders';
import { jsonBody, errorHandler } from '../jsonBody';

// Mirrors the relevant slice of index.ts (which calls listen() on import and so cannot
// be imported by a test): x-powered-by off, securityHeaders, jsonBody, real routers,
// errorHandler. Issues #208 (headers) and #211 (body limit).
function buildApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(jsonBody);
  app.use('/api/auth', authRouter);
  app.use('/api/books', booksRouter);
  app.use(errorHandler);
  return app;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('security headers (#208)', () => {
  it('sets the baseline headers and drops X-Powered-By on a normal route', async () => {
    const res = await request(buildApp()).get('/api/books');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('never sets headers that would block the cross-origin client', async () => {
    const res = await request(buildApp()).get('/api/books');
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
    expect(res.headers['cross-origin-embedder-policy']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('sets Strict-Transport-Security only in production', async () => {
    process.env.NODE_ENV = 'test';
    const dev = await request(buildApp()).get('/api/books');
    expect(dev.headers['strict-transport-security']).toBeUndefined();

    process.env.NODE_ENV = 'production';
    const prod = await request(buildApp()).get('/api/books');
    expect(prod.headers['strict-transport-security']).toMatch(/^max-age=\d+/);
  });
});

describe('JSON body limit (#211)', () => {
  it('returns a 413 JSON envelope for an over-limit body', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'Request body too large' });
  });

  it('still accepts a normal-size body on a real route', async () => {
    const email = `hardening-${Date.now()}@example.com`;
    await allowEmail(email);
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ email, name: 'Hardening Tester', password: 'test-password' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ token: expect.any(String) });
  });
});
