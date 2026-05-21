import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import authRouter from '../auth';
import testRouter from '../test';
import { resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';

// Build a test app that mounts the cleanup router behind the same path
// production index.ts uses. We mount auth too so we can register a real user
// in the happy-path test.
function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/_test', testRouter);
  return app;
}

describe('Test-only cleanup routes', () => {
  let app: Express;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.TEST_SECRET;

  beforeEach(async () => {
    await resetDatabase();
    app = createApp();
    delete process.env.TEST_SECRET; // exercise the dev-test-secret fallback
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) {
      delete process.env.TEST_SECRET;
    } else {
      process.env.TEST_SECRET = originalSecret;
    }
  });

  describe('DELETE /api/_test/user-by-email', () => {
    // Note on the NODE_ENV test: in production the router is not mounted at
    // all by index.ts. We can't reliably exercise the "unmounted" behavior
    // here because the app object was constructed once in beforeEach. Instead
    // the handler itself short-circuits with a 404 when NODE_ENV === 'production',
    // and that's what we verify here. The two layers together (unmounted +
    // handler-level 404) make the production path fail closed.
    it('returns 404 when NODE_ENV is production', async () => {
      process.env.NODE_ENV = 'production';

      const res = await request(app)
        .delete('/api/_test/user-by-email')
        .set('x-test-secret', 'dev-test-secret')
        .send({ email: 'anyone@example.com' });

      expect(res.status).toBe(404);
    });

    it('returns 401 when x-test-secret is missing or wrong', async () => {
      const missing = await request(app)
        .delete('/api/_test/user-by-email')
        .send({ email: 'anyone@example.com' });
      expect(missing.status).toBe(401);

      const wrong = await request(app)
        .delete('/api/_test/user-by-email')
        .set('x-test-secret', 'definitely-not-the-secret')
        .send({ email: 'anyone@example.com' });
      expect(wrong.status).toBe(401);
    });

    it('deletes a registered user and is idempotent on a second call', async () => {
      const email = 'cleanup-target@example.com';
      const register = await request(app)
        .post('/api/auth/register')
        .send({ email, name: 'Cleanup Target', password: 'pw-test-1234' });
      expect(register.status).toBe(201);

      // Sanity: the user is in the DB.
      const before = await prisma.user.findUnique({ where: { email } });
      expect(before).not.toBeNull();

      const res = await request(app)
        .delete('/api/_test/user-by-email')
        .set('x-test-secret', 'dev-test-secret')
        .send({ email });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, deleted: 1 });

      const after = await prisma.user.findUnique({ where: { email } });
      expect(after).toBeNull();

      // Second call: idempotent — 200, deleted: 0.
      const res2 = await request(app)
        .delete('/api/_test/user-by-email')
        .set('x-test-secret', 'dev-test-secret')
        .send({ email });
      expect(res2.status).toBe(200);
      expect(res2.body).toEqual({ ok: true, deleted: 0 });
    });
  });
});
