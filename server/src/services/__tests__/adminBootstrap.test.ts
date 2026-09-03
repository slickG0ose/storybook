import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { hashPassword } from '../../lib/password';
import { reconcileAdmins, DEMOTE_ALL_SENTINEL } from '../adminBootstrap';

/**
 * Behaviour table for `reconcileAdmins()`.
 *
 * The env var is the source of truth and is reconciled on every call, so every
 * test stubs `ADMIN_BOOTSTRAP_EMAILS` explicitly and unstubs afterwards — a
 * leaked stub would silently demote the admin a later test just created.
 *
 * Registration is closed by default, so `allowEmail()` comes before every
 * `/register` (mirrors server/src/routes/__tests__/allowlist.test.ts).
 */

/** Register through the real gate and return the created row's id. */
async function register(app: Express, email: string, name = 'Person'): Promise<string> {
  await allowEmail(email);
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, name, password: 'pw-test-1234' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function roleOf(email: string): Promise<string | undefined> {
  const user = await prisma.user.findFirst({ where: { email } });
  return user?.role;
}

describe('reconcileAdmins', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    // The service logs a summary on every change; keep the suite output clean
    // while still allowing assertions on the guard-2 warning.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('promotion', () => {
    it('promotes a registered listed user, and is idempotent on a second run', async () => {
      await register(app, 'owner@example.com');
      vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', 'owner@example.com');

      const first = await reconcileAdmins();
      expect(first).toEqual({
        promoted: ['owner@example.com'],
        demoted: [],
        missing: [],
        skipped: false,
      });
      expect(await roleOf('owner@example.com')).toBe('admin');

      // Second identical run: already reconciled, so nothing moves. This is
      // what makes "reconcile on every boot" safe to run repeatedly.
      const second = await reconcileAdmins();
      expect(second.promoted).toEqual([]);
      expect(second.demoted).toEqual([]);
      expect(await roleOf('owner@example.com')).toBe('admin');
    });

    it('normalizes case and whitespace in the env var', async () => {
      await register(app, 'owner@example.com');
      vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', '  Owner@Example.COM ');

      const result = await reconcileAdmins();

      expect(result.promoted).toEqual(['owner@example.com']);
      expect(result.missing).toEqual([]);
      expect(await roleOf('owner@example.com')).toBe('admin');
    });

    it('promotes a user whose STORED email has mixed case', async () => {
      // Regression guard: POST /api/auth/register writes the raw request value,
      // so User.email can hold mixed case. A `where: { email: { in: [...] } }`
      // over lowercased addresses would silently miss this row — i.e. fail to
      // promote exactly the admin it was asked to. Created directly so the row
      // is mixed-case regardless of what the register route does today.
      await prisma.user.create({
        data: {
          email: 'Nick@Gmail.com',
          name: 'Nick',
          password_hash: hashPassword('pw-test-1234'),
          token: 'token-mixed-case',
        },
      });
      vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', 'nick@gmail.com');

      const result = await reconcileAdmins();

      expect(result.promoted).toEqual(['nick@gmail.com']);
      expect(result.missing).toEqual([]);
      expect(await roleOf('Nick@Gmail.com')).toBe('admin');
    });

    it('never promotes a soft-deleted user', async () => {
      const id = await register(app, 'gone@example.com');
      await prisma.user.update({ where: { id }, data: { deleted_at: new Date() } });
      vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', 'gone@example.com');

      const result = await reconcileAdmins();

      expect(result.promoted).toEqual([]);
      // A tombstoned account is not a live account, so it reads as missing.
      expect(result.missing).toEqual(['gone@example.com']);
      expect(await roleOf('gone@example.com')).toBe('user');
    });
  });

  describe('missing addresses', () => {
    it('reports an unregistered address, creates no user row, and promotes it once registered', async () => {
      const before = await prisma.user.count();
      vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', 'future@example.com');

      const first = await reconcileAdmins();

      expect(first.missing).toEqual(['future@example.com']);
      expect(first.promoted).toEqual([]);
      // Promotion never creates an account — no password ever lives in config.
      expect(await prisma.user.count()).toBe(before);

      // The listed-before-registered window resolves itself on the next run.
      await register(app, 'future@example.com');
      const second = await reconcileAdmins();

      expect(second.promoted).toEqual(['future@example.com']);
      expect(second.missing).toEqual([]);
      expect(await roleOf('future@example.com')).toBe('admin');
    });
  });

  describe('demotion', () => {
    it('demotes an admin who is not in the var, leaving the account intact', async () => {
      const keepId = await register(app, 'keep@example.com');
      const dropId = await register(app, 'drop@example.com');
      await prisma.user.updateMany({
        where: { id: { in: [keepId, dropId] } },
        data: { role: 'admin' },
      });
      const dropBefore = await prisma.user.findUniqueOrThrow({ where: { id: dropId } });
      await prisma.book.create({
        data: {
          id: 'drop-owned-book',
          title: 'Owned Book',
          author: 'Drop',
          description: 'Still theirs after demotion.',
          theme: 'friendship',
          age_range: '4-7',
          cover_emoji: '\u{1F4D8}',
          cover_color: '#7c3aed',
          price: 19.99,
          is_user_created: true,
          created_by: dropId,
        },
      });

      vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', 'keep@example.com');
      const result = await reconcileAdmins();

      expect(result.demoted).toEqual(['drop@example.com']);
      expect(result.promoted).toEqual([]);
      expect(await roleOf('keep@example.com')).toBe('admin');

      // Demotion writes role and nothing else: the row, its token, and its
      // books all survive, so re-adding the email restores admin.
      const dropAfter = await prisma.user.findUniqueOrThrow({ where: { id: dropId } });
      expect(dropAfter.role).toBe('user');
      expect(dropAfter.token).toBe(dropBefore.token);
      expect(dropAfter.deleted_at).toBeNull();
      expect(await prisma.book.count({ where: { created_by: dropId } })).toBe(1);
    });

    it.each([DEMOTE_ALL_SENTINEL, 'NONE '])(
      'demotes every admin and promotes nobody when the var is %o',
      async sentinel => {
        const aId = await register(app, 'a@example.com');
        const bId = await register(app, 'b@example.com');
        await prisma.user.updateMany({
          where: { id: { in: [aId, bId] } },
          data: { role: 'admin' },
        });
        await register(app, 'plain@example.com');

        vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', sentinel);
        const result = await reconcileAdmins();

        expect(result.skipped).toBe(false);
        expect(result.promoted).toEqual([]);
        expect(result.demoted.sort()).toEqual(['a@example.com', 'b@example.com']);
        expect(result.missing).toEqual([]);
        expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(0);
        expect(await roleOf('plain@example.com')).toBe('user');
      },
    );
  });

  describe('guards — values that must write nothing', () => {
    it.each([
      ['unset', undefined],
      ['blank', '   '],
      ['unparseable', ',,not-an-email'],
    ])('is a total no-op when the var is %s', async (_label, value) => {
      const id = await register(app, 'existing-admin@example.com');
      await prisma.user.update({ where: { id }, data: { role: 'admin' } });
      vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', value);

      const result = await reconcileAdmins();

      expect(result).toEqual({ promoted: [], demoted: [], missing: [], skipped: true });
      // The footgun this guards: a fat-fingered dashboard edit must never
      // mass-demote. Only a var with a real address (or `none`) writes.
      expect(await roleOf('existing-admin@example.com')).toBe('admin');
    });

    it('warns when the var is set but holds no usable address', async () => {
      vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', ',,not-an-email');

      await reconcileAdmins();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('no usable address'),
      );
    });
  });
});
