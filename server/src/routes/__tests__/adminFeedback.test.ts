import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, allowEmail, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';

/**
 * Admin feedback triage routes (#157, task 4). Kept out of admin.test.ts, which is
 * already large. Fixtures are written straight to Prisma: the tester POST is covered
 * in feedback.test.ts, and going through it here would drag its rate limit along.
 */

async function createUserAndGetToken(
  app: Express,
  email: string,
  role: 'user' | 'admin' = 'user',
): Promise<{ token: string; userId: string }> {
  await allowEmail(email);
  const reg = await request(app).post('/api/auth/register').send({
    email,
    name: email.split('@')[0],
    password: 'pass1234',
  });
  const token = reg.body.token as string;
  const userId = reg.body.id as string;
  if (role === 'admin') {
    await prisma.user.update({ where: { id: userId }, data: { role: 'admin' } });
  }
  return { token, userId };
}

function feedbackData(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    session_id: '11111111-2222-3333-4444-555555555555',
    category: 'bug',
    message: 'The page turn button did nothing.',
    route: '/book/luna-star-garden?theater=1',
    book_id: 'luna-star-garden',
    user_agent: 'Mozilla/5.0 TestPhone',
    viewport_width: 393,
    viewport_height: 852,
    theme: 'dark',
    client_build: 'abc1234',
    server_build: 'def5678',
    recent_errors_json: JSON.stringify(['TypeError: x is undefined']),
    ...overrides,
  };
}

describe('Admin feedback routes', () => {
  let app: Express;
  let adminToken: string;
  let testerToken: string;
  let testerId: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    ({ token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin'));
    ({ token: testerToken, userId: testerId } = await createUserAndGetToken(
      app,
      'tester@example.com',
    ));
  });

  describe('GET /api/admin/feedback', () => {
    it('200 with every AdminFeedbackItem field, newest first', async () => {
      const t0 = Date.parse('2026-11-01T10:00:00.000Z');
      const oldest = await prisma.feedback.create({
        data: feedbackData(testerId, { message: 'oldest', created_at: new Date(t0) }),
      });
      const newest = await prisma.feedback.create({
        data: feedbackData(testerId, { message: 'newest', created_at: new Date(t0 + 120_000) }),
      });
      const middle = await prisma.feedback.create({
        data: feedbackData(testerId, { message: 'middle', created_at: new Date(t0 + 60_000) }),
      });

      const res = await request(app)
        .get('/api/admin/feedback')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.map((f: { id: string }) => f.id)).toEqual([newest.id, middle.id, oldest.id]);
      expect(res.body[0]).toMatchObject({
        id: newest.id,
        user_id: testerId,
        user_email: 'tester@example.com',
        user_name: 'tester',
        session_id: '11111111-2222-3333-4444-555555555555',
        category: 'bug',
        message: 'newest',
        route: '/book/luna-star-garden?theater=1',
        book_id: 'luna-star-garden',
        book_title: expect.any(String),
        user_agent: 'Mozilla/5.0 TestPhone',
        viewport_width: 393,
        viewport_height: 852,
        theme: 'dark',
        client_build: 'abc1234',
        server_build: 'def5678',
        recent_errors: ['TypeError: x is undefined'],
        status: 'new',
        created_at: '2026-11-01T10:02:00.000Z',
        updated_at: expect.any(String),
      });
      expect(Number.isNaN(Date.parse(res.body[0].updated_at))).toBe(false);
    });

    it('parses null and unparseable recent_errors_json back to []', async () => {
      await prisma.feedback.create({ data: feedbackData(testerId, { recent_errors_json: null }) });
      await prisma.feedback.create({
        data: feedbackData(testerId, { recent_errors_json: '{not json' }),
      });

      const res = await request(app)
        .get('/api/admin/feedback')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      for (const item of res.body) expect(item.recent_errors).toEqual([]);
    });

    it('?status= and ?user_id= each narrow the list', async () => {
      const { userId: otherId } = await createUserAndGetToken(app, 'other@example.com');
      const triaged = await prisma.feedback.create({
        data: feedbackData(testerId, { status: 'triaged' }),
      });
      await prisma.feedback.create({ data: feedbackData(testerId) });
      const fromOther = await prisma.feedback.create({ data: feedbackData(otherId) });

      const byStatus = await request(app)
        .get('/api/admin/feedback?status=triaged')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(byStatus.status).toBe(200);
      expect(byStatus.body.map((f: { id: string }) => f.id)).toEqual([triaged.id]);

      const byUser = await request(app)
        .get(`/api/admin/feedback?user_id=${otherId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(byUser.status).toBe(200);
      expect(byUser.body.map((f: { id: string }) => f.id)).toEqual([fromOther.id]);
    });

    it('?status=bogus → 400 { error }', async () => {
      const res = await request(app)
        .get('/api/admin/feedback?status=bogus')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it('book_title is null after the book is hard-deleted', async () => {
      const book = await prisma.book.create({
        data: {
          title: 'Disposable Book',
          author: 'Test',
          description: 'Deleted mid-test.',
          theme: 'fantasy',
          age_range: '4-7',
          cover_emoji: '\u{1F4D5}',
          cover_color: '#000000',
          price: 1,
        },
      });
      await prisma.feedback.create({ data: feedbackData(testerId, { book_id: book.id }) });

      const before = await request(app)
        .get('/api/admin/feedback')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(before.body[0]).toMatchObject({ book_id: book.id, book_title: 'Disposable Book' });

      await prisma.book.delete({ where: { id: book.id } });

      const after = await request(app)
        .get('/api/admin/feedback')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(after.status).toBe(200);
      expect(after.body[0]).toMatchObject({ book_id: null, book_title: null });
    });

    it('signed out → 401 { error }', async () => {
      const res = await request(app).get('/api/admin/feedback');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it('non-admin → 403 { error }', async () => {
      const res = await request(app)
        .get('/api/admin/feedback')
        .set('Authorization', `Bearer ${testerToken}`);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });
  });

  describe('PATCH /api/admin/feedback/:id', () => {
    it('200 with the full item, the status changes, and updated_at advances', async () => {
      const stale = new Date(Date.now() - 60_000);
      const row = await prisma.feedback.create({
        data: feedbackData(testerId, { updated_at: stale }),
      });
      expect(row.updated_at.getTime()).toBe(stale.getTime());

      const res = await request(app)
        .patch(`/api/admin/feedback/${row.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'triaged' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: row.id,
        user_id: testerId,
        user_email: 'tester@example.com',
        user_name: 'tester',
        session_id: '11111111-2222-3333-4444-555555555555',
        category: 'bug',
        message: 'The page turn button did nothing.',
        route: '/book/luna-star-garden?theater=1',
        book_id: 'luna-star-garden',
        book_title: expect.any(String),
        user_agent: 'Mozilla/5.0 TestPhone',
        viewport_width: 393,
        viewport_height: 852,
        theme: 'dark',
        client_build: 'abc1234',
        server_build: 'def5678',
        recent_errors: ['TypeError: x is undefined'],
        status: 'triaged',
        created_at: row.created_at.toISOString(),
        updated_at: expect.any(String),
      });
      expect(Date.parse(res.body.updated_at)).toBeGreaterThan(stale.getTime());

      const stored = await prisma.feedback.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored.status).toBe('triaged');
      expect(stored.updated_at.getTime()).toBeGreaterThan(stale.getTime());
    });

    it('unknown id → 404 { error }', async () => {
      const res = await request(app)
        .patch('/api/admin/feedback/does-not-exist')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'done' });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'Feedback not found.' });
    });

    it("{ status: 'archived' } → 400 { error }", async () => {
      const row = await prisma.feedback.create({ data: feedbackData(testerId) });
      const res = await request(app)
        .patch(`/api/admin/feedback/${row.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect((await prisma.feedback.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        'new',
      );
    });

    it('signed out → 401 { error }', async () => {
      const row = await prisma.feedback.create({ data: feedbackData(testerId) });
      const res = await request(app)
        .patch(`/api/admin/feedback/${row.id}`)
        .send({ status: 'done' });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it('non-admin with a bad body → 403, not 400 (auth beats validation)', async () => {
      const row = await prisma.feedback.create({ data: feedbackData(testerId) });
      const res = await request(app)
        .patch(`/api/admin/feedback/${row.id}`)
        .set('Authorization', `Bearer ${testerToken}`)
        .send({ status: 'archived' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect((await prisma.feedback.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        'new',
      );
    });
  });
});
