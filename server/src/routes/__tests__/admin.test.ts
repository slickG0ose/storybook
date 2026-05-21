import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { createTestApp, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';

// Mirrors ILLUSTRATIONS_DIR computation in admin.ts. The test file lives at
// server/src/routes/__tests__/admin.test.ts, so two levels up is server/src/,
// then ../public/illustrations resolves to server/public/illustrations — same
// directory the route reads from.
const ILLUSTRATIONS_DIR = resolve(import.meta.dirname, '../../../public/illustrations');

/**
 * Create a fake illustration directory with one placeholder file inside so
 * the route's stat() check passes. Track created dirs so afterEach can clean
 * them up even on test failure.
 */
async function createOrphanDir(name: string): Promise<string> {
  const dir = join(ILLUSTRATIONS_DIR, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'placeholder.png'), 'fake-image-bytes');
  return dir;
}

/**
 * Returns a registered user's token. `role` defaults to 'user' — pass 'admin'
 * to promote the row after registration (the public /register endpoint
 * intentionally never creates admins).
 */
async function createUserAndGetToken(
  app: Express,
  email: string,
  role: 'user' | 'admin' = 'user',
): Promise<{ token: string; userId: string }> {
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

describe('Admin API routes', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  describe('requireAdmin gating', () => {
    it('returns 401 without auth on a sample admin endpoint', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('returns 403 for a regular authed user on a sample admin endpoint', async () => {
      const { token } = await createUserAndGetToken(app, 'regular@example.com');
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 for an admin on a sample admin endpoint', async () => {
      const { token } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/admin/users', () => {
    it('returns all users including soft-deleted, stripped of secrets', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const { userId: regularId } = await createUserAndGetToken(app, 'regular@example.com');

      // Soft-delete the regular user — admin should still see them.
      await prisma.user.update({
        where: { id: regularId },
        data: { deleted_at: new Date() },
      });

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const regular = res.body.find((u: { email: string }) => u.email === 'regular@example.com');
      expect(regular).toBeDefined();
      expect(regular.deleted_at).not.toBeNull();
      expect(regular).not.toHaveProperty('password_hash');
      expect(regular).not.toHaveProperty('token');

      // Admin user is the most-recently-created (created_at desc).
      expect(res.body[0].email).toBe('regular@example.com');
    });
  });

  describe('GET /api/admin/books', () => {
    it('returns all books including soft-deleted with creator info', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const { userId: regularId } = await createUserAndGetToken(app, 'regular@example.com');

      // Tie a seeded book to the regular user, then soft-delete it.
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { created_by: regularId, deleted_at: new Date() },
      });

      const res = await request(app)
        .get('/api/admin/books')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      // All 6 seeded books appear, even the soft-deleted one.
      expect(res.body).toHaveLength(6);
      const luna = res.body.find((b: { id: string }) => b.id === 'luna-star-garden');
      expect(luna).toBeDefined();
      expect(luna.deleted_at).not.toBeNull();
      expect(luna.creator).toEqual({ email: 'regular@example.com', name: 'regular' });
    });
  });

  describe('PUT /api/admin/users/:id/restore', () => {
    it('clears deleted_at on a soft-deleted user', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const { userId } = await createUserAndGetToken(app, 'regular@example.com');

      await prisma.user.update({
        where: { id: userId },
        data: { deleted_at: new Date() },
      });

      const res = await request(app)
        .put(`/api/admin/users/${userId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.deleted_at).toBeNull();

      const row = await prisma.user.findUnique({ where: { id: userId } });
      expect(row?.deleted_at).toBeNull();
    });

    it('returns 404 for an unknown user id', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const res = await request(app)
        .put('/api/admin/users/does-not-exist/restore')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/books/:id/restore', () => {
    it('clears deleted_at on a soft-deleted book', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { deleted_at: new Date() },
      });

      const res = await request(app)
        .put('/api/admin/books/luna-star-garden/restore')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.deleted_at).toBeNull();

      const row = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(row?.deleted_at).toBeNull();
    });

    it('returns 404 for an unknown book id', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const res = await request(app)
        .put('/api/admin/books/does-not-exist/restore')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/books/:id/featured', () => {
    it('toggles is_featured on and off', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');

      // Pick a book that's currently not featured.
      const before = await prisma.book.findUnique({ where: { id: 'dinosaur-bakery' } });
      expect(before?.is_featured).toBe(false);

      const on = await request(app)
        .put('/api/admin/books/dinosaur-bakery/featured')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_featured: true });
      expect(on.status).toBe(200);
      expect(on.body.is_featured).toBe(true);

      const off = await request(app)
        .put('/api/admin/books/dinosaur-bakery/featured')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_featured: false });
      expect(off.status).toBe(200);
      expect(off.body.is_featured).toBe(false);
    });

    it('returns 400 when is_featured is not a boolean', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const res = await request(app)
        .put('/api/admin/books/luna-star-garden/featured')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown book id', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const res = await request(app)
        .put('/api/admin/books/nope/featured')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_featured: true });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/orphan-illustrations/:id', () => {
    // Track every directory created during a test so afterEach can clean up
    // even if assertions fail mid-test.
    const createdDirs: string[] = [];

    async function trackOrphanDir(name: string): Promise<string> {
      const dir = await createOrphanDir(name);
      createdDirs.push(dir);
      return dir;
    }

    afterEach(async () => {
      while (createdDirs.length > 0) {
        const dir = createdDirs.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
      }
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).delete('/api/admin/orphan-illustrations/anything');
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin user', async () => {
      const { token } = await createUserAndGetToken(app, 'regular@example.com');
      const res = await request(app)
        .delete('/api/admin/orphan-illustrations/anything')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('deletes an orphan directory and echoes the dir name', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const orphanName = 'test-orphan-no-book-row';
      const dir = await trackOrphanDir(orphanName);

      // Sanity: dir exists before the request.
      expect(existsSync(dir)).toBe(true);

      const res = await request(app)
        .delete(`/api/admin/orphan-illustrations/${orphanName}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: orphanName });
      expect(existsSync(dir)).toBe(false);
    });

    it('after deletion, the dir no longer appears in the orphan list', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const orphanName = 'test-orphan-disappears-from-list';
      await trackOrphanDir(orphanName);

      const before = await request(app)
        .get('/api/admin/orphan-illustrations')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(before.body.some((o: { path: string }) => o.path.endsWith(`/${orphanName}`))).toBe(
        true,
      );

      const del = await request(app)
        .delete(`/api/admin/orphan-illustrations/${orphanName}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(200);

      const after = await request(app)
        .get('/api/admin/orphan-illustrations')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(after.body.some((o: { path: string }) => o.path.endsWith(`/${orphanName}`))).toBe(
        false,
      );
    });

    it('deletes a directory for a soft-deleted book (orphan-of-orphan)', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      // Use a seeded book id so a real row exists, then tombstone it. The
      // listing endpoint surfaces this as { soft_deleted: true } — deletion
      // should still be allowed.
      const orphanName = 'luna-star-garden';
      await trackOrphanDir(orphanName);
      await prisma.book.update({
        where: { id: orphanName },
        data: { deleted_at: new Date() },
      });

      const res = await request(app)
        .delete(`/api/admin/orphan-illustrations/${orphanName}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: orphanName });
    });

    it('returns 409 when the directory belongs to a live book', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      // luna-star-garden is seeded live; even if its directory exists on disk,
      // the route should refuse to delete it. (This is defense-in-depth — the
      // listing endpoint already filters live books out, so this 409 should
      // never fire under normal admin UI flow.)
      const orphanName = 'luna-star-garden';
      const dir = await trackOrphanDir(orphanName);

      const res = await request(app)
        .delete(`/api/admin/orphan-illustrations/${orphanName}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Cannot delete: directory belongs to a live book');
      // Directory MUST still exist after a refused delete.
      expect(existsSync(dir)).toBe(true);
    });

    it('returns 404 when the directory does not exist on disk', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const res = await request(app)
        .delete('/api/admin/orphan-illustrations/this-directory-does-not-exist-on-disk')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Orphan directory not found');
    });

    it('returns 400 on classic path-traversal attempts', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');

      // Express normalizes most of these in the URL; the ones that reach the
      // handler still need to be refused by the in-handler guard. Use the
      // .delete(<url>) form so supertest doesn't pre-normalize.
      const attacks = [
        '/api/admin/orphan-illustrations/..%2Fetc',
        '/api/admin/orphan-illustrations/..%5Csecret',
        '/api/admin/orphan-illustrations/foo%2F..%2F..%2Fetc',
      ];
      for (const url of attacks) {
        const res = await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status, `expected 400 for ${url}, got ${res.status}`).toBe(400);
        expect(res.body.error).toBe('Invalid request: path traversal');
      }
    });

    it('refuses bare ".." even when illustrations dir is missing', async () => {
      // If something escapes the prefix check this would 404, but the surface
      // guard rejects it first.
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');
      const res = await request(app)
        .delete('/api/admin/orphan-illustrations/..%2F..')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/admin/orphan-illustrations', () => {
    it('does not include books that exist as live rows', async () => {
      const { token: adminToken } = await createUserAndGetToken(app, 'admin@example.com', 'admin');

      // Seeded books all exist; if their directories happen to also exist on
      // disk they should NOT be in the orphans list. The strongest assertion
      // we can make in a unit test (without writing files) is that any
      // returned entry points at an id that is not a live book row.
      const res = await request(app)
        .get('/api/admin/orphan-illustrations')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const liveBooks = await prisma.book.findMany({ where: { deleted_at: null } });
      const liveIds = new Set(liveBooks.map(b => b.id));
      for (const orphan of res.body) {
        // path is /illustrations/<id> — split and grab the id.
        const id = orphan.path.split('/').pop();
        expect(liveIds.has(id)).toBe(false);
        expect(orphan).toHaveProperty('book_exists');
        expect(orphan).toHaveProperty('soft_deleted');
      }
    });
  });
});
