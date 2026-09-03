import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { hashPassword } from '../../lib/password';
import { backfillUserEmails } from '../emailBackfill';

/**
 * Behaviour table for `backfillUserEmails()` (spec Decisions 5 and 6).
 *
 * Rows are seeded with `prisma.user.create` rather than through /register,
 * because /register now normalizes on write and could not produce the
 * mixed-case rows this exists to converge.
 */

const PASSWORD = 'pw-test-1234';

async function seedUser(opts: {
  email: string;
  name?: string;
  createdAt?: Date;
  deletedAt?: Date | null;
}): Promise<string> {
  const row = await prisma.user.create({
    data: {
      email: opts.email,
      name: opts.name ?? 'Person',
      password_hash: hashPassword(PASSWORD),
      created_at: opts.createdAt,
      deleted_at: opts.deletedAt ?? null,
    },
  });
  return row.id;
}

async function emailOf(id: string): Promise<string | undefined> {
  const row = await prisma.user.findUnique({ where: { id } });
  return row?.email;
}

describe('backfillUserEmails', () => {
  beforeEach(async () => {
    await resetDatabase();
    // Collisions warn on every run by design; keep the suite output readable.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lowercases a mixed-case row and is idempotent on a second run', async () => {
    const id = await seedUser({ email: 'Nick@Gmail.com' });

    const first = await backfillUserEmails();
    expect(first).toEqual({ normalized: ['nick@gmail.com'], collisions: [] });
    expect(await emailOf(id)).toBe('nick@gmail.com');

    const second = await backfillUserEmails();
    expect(second).toEqual({ normalized: [], collisions: [] });
  });

  it('is a total no-op on an already-normalized table', async () => {
    await seedUser({ email: 'a@example.com' });
    await seedUser({ email: 'b@example.com' });

    expect(await backfillUserEmails()).toEqual({ normalized: [], collisions: [] });
  });

  it('elects the older row when two live rows collide, and leaves the newer untouched', async () => {
    const olderId = await seedUser({
      email: 'Nick@Gmail.com',
      name: 'Older',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newerId = await seedUser({
      email: 'NICK@gmail.com',
      name: 'Newer',
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    const result = await backfillUserEmails();

    expect(result.normalized).toEqual(['nick@gmail.com']);
    expect(result.collisions).toEqual([
      {
        normalizedEmail: 'nick@gmail.com',
        keptId: olderId,
        skipped: [{ id: newerId, email: 'NICK@gmail.com', deleted: false }],
      },
    ]);
    // Never merged, never deleted: both rows survive with their own data.
    expect(await emailOf(olderId)).toBe('nick@gmail.com');
    expect(await emailOf(newerId)).toBe('NICK@gmail.com');
    expect(await prisma.user.count()).toBe(2);
  });

  it('lets the live row win over a tombstone without hitting a unique violation', async () => {
    // The tombstone is the OLDER row here, so only the live-beats-deleted rule
    // can produce this outcome.
    const tombstoneId = await seedUser({
      email: 'Nick@Gmail.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const liveId = await seedUser({
      email: 'nick@gmail.com',
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    const result = await backfillUserEmails();

    // The live row already holds the normalized address, so there is nothing
    // to write — but the group is still reported so a human can resolve it.
    expect(result.normalized).toEqual([]);
    expect(result.collisions).toEqual([
      {
        normalizedEmail: 'nick@gmail.com',
        keptId: liveId,
        skipped: [{ id: tombstoneId, email: 'Nick@Gmail.com', deleted: true }],
      },
    ]);
    expect(await emailOf(tombstoneId)).toBe('Nick@Gmail.com');
    expect(await emailOf(liveId)).toBe('nick@gmail.com');
  });

  it('normalizes a tombstoned row that collides with nothing', async () => {
    // A later PUT /api/admin/users/:id/restore must not resurrect the bug.
    const id = await seedUser({ email: 'Ghost@Example.com', deletedAt: new Date() });

    expect(await backfillUserEmails()).toEqual({
      normalized: ['ghost@example.com'],
      collisions: [],
    });
    expect(await emailOf(id)).toBe('ghost@example.com');
  });

  it('lets a previously mixed-case user log in with the lowercase form afterwards', async () => {
    const app: Express = createTestApp();
    await seedUser({ email: 'Nick@Gmail.com', name: 'Nick' });

    const before = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nick@gmail.com', password: PASSWORD });
    expect(before.status).toBe(401);

    await backfillUserEmails();

    const after = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nick@gmail.com', password: PASSWORD });
    expect(after.status).toBe(200);
    expect(after.body.email).toBe('nick@gmail.com');
  });
});
