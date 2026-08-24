import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import {
  COST_CENTS,
  OPENAI_IMAGE_COST_CENTS,
  costCentsFor,
  checkQuota,
  recordUsage,
  startOfUtcDay,
  startOfUtcMonth,
  userSpendTodayCents,
  globalSpendThisMonthCents,
  dailyPerUserLimitCents,
  monthlyGlobalLimitCents,
} from '../../services/spend';

async function makeUser(
  app: Express,
  email: string,
  role: 'user' | 'admin' = 'user',
): Promise<{ id: string; token: string }> {
  await allowEmail(email);
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email, name: email.split('@')[0], password: 'pw-test-1234' });
  const id = reg.body.id as string;
  if (role === 'admin') {
    await prisma.user.update({ where: { id }, data: { role: 'admin' } });
  }
  return { id, token: reg.body.token as string };
}

/** Write usage directly, bypassing the routes, to set up a spend state. */
async function seedSpend(userId: string, cents: number, when: Date = new Date()): Promise<void> {
  await prisma.usageLog.create({
    data: { user_id: userId, kind: 'story', cost_cents: cents, created_at: when },
  });
}

describe('spend service — window math', () => {
  it('startOfUtcDay zeroes the time in UTC', () => {
    const d = startOfUtcDay(new Date('2026-08-15T23:45:12.000Z'));
    expect(d.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('startOfUtcMonth goes to the 1st in UTC', () => {
    const d = startOfUtcMonth(new Date('2026-08-15T23:45:12.000Z'));
    expect(d.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('uses UTC rather than local time, so the reset point never shifts', () => {
    // 2026-08-16T01:30Z is still Aug 15 in US timezones. A local-time
    // implementation would return Aug 15 here and quietly move the rollover.
    const d = startOfUtcDay(new Date('2026-08-16T01:30:00.000Z'));
    expect(d.toISOString()).toBe('2026-08-16T00:00:00.000Z');
  });
});

describe('spend service — sums', () => {
  let userId: string;
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    ({ id: userId } = await makeUser(app, 'spender@example.com'));
  });

  it('sums only today for the per-user window', async () => {
    await seedSpend(userId, 10);
    // Two days ago — same month, different day.
    await seedSpend(userId, 99, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

    expect(await userSpendTodayCents(userId)).toBe(10);
  });

  it('sums across users for the global monthly window', async () => {
    const other = await makeUser(app, 'other@example.com');
    await seedSpend(userId, 10);
    await seedSpend(other.id, 15);

    expect(await globalSpendThisMonthCents()).toBe(25);
  });

  it('returns 0 rather than null when there is no usage', async () => {
    expect(await userSpendTodayCents(userId)).toBe(0);
    expect(await globalSpendThisMonthCents()).toBe(0);
  });

  it('recordUsage writes the configured cost for the kind', async () => {
    await recordUsage(userId, 'illustration');
    expect(await userSpendTodayCents(userId)).toBe(COST_CENTS.illustration);
  });
});

describe('spend service — limits from env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads limits from env', () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '123');
    vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '4567');
    expect(dailyPerUserLimitCents()).toBe(123);
    expect(monthlyGlobalLimitCents()).toBe(4567);
  });

  it('falls back to the default on a malformed limit rather than disabling the gate', () => {
    // The dangerous failure here is a typo silently meaning "no limit".
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', 'not-a-number');
    expect(dailyPerUserLimitCents()).toBe(50);
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '-5');
    expect(dailyPerUserLimitCents()).toBe(50);
  });
});

describe('checkQuota', () => {
  let app: Express;
  let userId: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    ({ id: userId } = await makeUser(app, 'quota-user@example.com'));
    ({ id: adminId } = await makeUser(app, 'quota-admin@example.com', 'admin'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows a call that fits under both ceilings', async () => {
    const d = await checkQuota(userId, 'story', false);
    expect(d.allowed).toBe(true);
  });

  it('blocks with reason "daily" once the per-user cap is reached', async () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '5');
    await seedSpend(userId, 5);

    const d = await checkQuota(userId, 'story', false);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('daily');
  });

  it('lets an admin past the daily cap when bypass is enabled', async () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '5');
    await seedSpend(adminId, 5);

    expect((await checkQuota(adminId, 'story', true)).allowed).toBe(true);
  });

  it('does not let an admin past the daily cap when bypass is disabled', async () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '5');
    vi.stubEnv('QUOTA_ADMIN_BYPASS', 'false');
    await seedSpend(adminId, 5);

    const d = await checkQuota(adminId, 'story', true);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('daily');
  });

  it('blocks with reason "monthly" once the global ceiling is reached', async () => {
    vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '5');
    await seedSpend(userId, 5);

    const d = await checkQuota(userId, 'story', false);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('monthly');
  });

  it('does NOT let an admin past the monthly ceiling', async () => {
    // The monthly ceiling protects the bill. An admin's spend costs the same
    // money as anyone else's, so bypass must not apply here.
    vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '5');
    await seedSpend(adminId, 5);

    const d = await checkQuota(adminId, 'story', true);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('monthly');
  });

  it('reports monthly before daily when both are exceeded', async () => {
    // Ordering matters: an admin bypassing the daily cap must still be stopped
    // by the monthly one, so monthly has to be evaluated first.
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '1');
    vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '1');
    await seedSpend(userId, 10);

    expect((await checkQuota(userId, 'story', false)).reason).toBe('monthly');
  });

  it('counts the cost of the pending call, not just prior spend', async () => {
    // A call that would land exactly ON the limit is fine; one that exceeds it
    // is not. This pins the boundary rather than leaving it to chance.
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', String(COST_CENTS.story));
    expect((await checkQuota(userId, 'story', false)).allowed).toBe(true);

    await seedSpend(userId, 1);
    expect((await checkQuota(userId, 'story', false)).allowed).toBe(false);
  });
});

describe('provider-aware cost — costCentsFor', () => {
  it('prices images at the default table when no provider is given', () => {
    // Every pre-existing caller passes no provider and must keep today's price.
    expect(costCentsFor('illustration')).toBe(4);
    expect(costCentsFor('cover')).toBe(4);
    expect(costCentsFor('illustration')).toBe(COST_CENTS.illustration);
  });

  it('prices fal images at the default table', () => {
    expect(costCentsFor('illustration', 'fal')).toBe(COST_CENTS.illustration);
    expect(costCentsFor('cover', 'fal')).toBe(COST_CENTS.cover);
  });

  it('prices openai images at OPENAI_IMAGE_COST_CENTS', () => {
    // gpt-image-1 runs 4-11x a Fal image; metering it at 4c would let a
    // pinned-openai book walk straight through the ceilings.
    expect(costCentsFor('illustration', 'openai')).toBe(OPENAI_IMAGE_COST_CENTS);
    expect(costCentsFor('cover', 'openai')).toBe(OPENAI_IMAGE_COST_CENTS);
    expect(OPENAI_IMAGE_COST_CENTS).toBeGreaterThan(COST_CENTS.illustration);

    // The literal matters. Every other assertion here computes its expectation
    // from OPENAI_IMAGE_COST_CENTS itself, so they all stay green if the
    // constant is changed to 5 or 500 — the value would be untested. 25c is a
    // specific owner ruling (Nick, 2026-08-23), the midpoint of ADR-006's
    // documented $0.17-0.45 range for gpt-image-1. Changing it should require
    // changing this line, deliberately.
    expect(OPENAI_IMAGE_COST_CENTS).toBe(25);
  });

  it('ignores the provider for text generation', () => {
    // The image pin says nothing about which model writes the story.
    expect(costCentsFor('story', 'openai')).toBe(COST_CENTS.story);
    expect(costCentsFor('story', 'fal')).toBe(COST_CENTS.story);
  });
});

describe('provider-aware cost — checkQuota / recordUsage', () => {
  let app: Express;
  let userId: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    ({ id: userId } = await makeUser(app, 'openai-user@example.com'));
    ({ id: adminId } = await makeUser(app, 'openai-admin@example.com', 'admin'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('recordUsage writes the openai rate when the provider is openai', async () => {
    await recordUsage(userId, 'illustration', 'openai');
    expect(await userSpendTodayCents(userId)).toBe(OPENAI_IMAGE_COST_CENTS);
  });

  it('recordUsage keeps the default rate when no provider is passed', async () => {
    await recordUsage(userId, 'illustration');
    expect(await userSpendTodayCents(userId)).toBe(COST_CENTS.illustration);
  });

  it('checkQuota and recordUsage agree on what a call cost', async () => {
    // The leak this guards: checking at 25c and recording at 4c would let 21c
    // per image escape both ceilings, one call at a time.
    const decision = await checkQuota(userId, 'illustration', false, new Date(), 'openai');
    expect(decision.allowed).toBe(true);
    expect(decision.costCents).toBe(OPENAI_IMAGE_COST_CENTS);

    await recordUsage(userId, 'illustration', 'openai');
    expect(await userSpendTodayCents(userId)).toBe(decision.costCents);
  });

  it('denies an openai image at a daily headroom where a fal one still fits', async () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '10');

    expect((await checkQuota(userId, 'illustration', false, new Date(), 'fal')).allowed).toBe(true);

    const openai = await checkQuota(userId, 'illustration', false, new Date(), 'openai');
    expect(openai.allowed).toBe(false);
    expect(openai.reason).toBe('daily');
  });

  it('denies an openai image at a monthly headroom where a fal one still fits', async () => {
    vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '10');

    expect((await checkQuota(userId, 'illustration', false, new Date(), 'fal')).allowed).toBe(true);

    const openai = await checkQuota(userId, 'illustration', false, new Date(), 'openai');
    expect(openai.allowed).toBe(false);
    expect(openai.reason).toBe('monthly');
  });

  it('still lets an admin past the DAILY cap at the openai rate', async () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '5');
    await seedSpend(adminId, 5);

    expect((await checkQuota(adminId, 'illustration', true, new Date(), 'openai')).allowed).toBe(
      true,
    );
  });

  it('does NOT let an admin past the MONTHLY ceiling at the openai rate', async () => {
    // The higher price must not open a bypass on the ceiling that protects the
    // bill — routing through a pinned-openai book cannot be an escape hatch.
    vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '5');

    const d = await checkQuota(adminId, 'illustration', true, new Date(), 'openai');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('monthly');
  });
});

describe('spendGate middleware over /api/generate', () => {
  let app: Express;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    ({ id: userId, token } = await makeUser(app, 'gate@example.com'));
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const body = { theme: 'space', ageRange: '5-7', characterName: 'Luna' };

  it('returns 429 with Retry-After when the daily cap is hit', async () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '1');
    await seedSpend(userId, 1);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(429);
    expect(res.body.quota).toMatchObject({ scope: 'daily', limitCents: 1 });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('returns 503 when the global monthly ceiling is hit', async () => {
    vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '1');
    await seedSpend(userId, 1);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(503);
    expect(res.body.quota).toMatchObject({ scope: 'monthly' });
  });

  it('still requires auth before it considers quota', async () => {
    const res = await request(app).post('/api/generate').send(body);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/spend', () => {
  let app: Express;
  let adminToken: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    const admin = await makeUser(app, 'spend-admin@example.com', 'admin');
    adminToken = admin.token;
    ({ id: userId } = await makeUser(app, 'spend-user@example.com'));
  });

  it('requires the admin role', async () => {
    const plain = await makeUser(app, 'plain@example.com');
    const res = await request(app)
      .get('/api/admin/spend')
      .set('Authorization', `Bearer ${plain.token}`);
    expect(res.status).toBe(403);
  });

  it('reports per-user daily spend and the global monthly total', async () => {
    await seedSpend(userId, 12);

    const res = await request(app)
      .get('/api/admin/spend')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      monthlyTotalCents: 12,
      dailyLimitCents: expect.any(Number),
      monthlyLimitCents: expect.any(Number),
      adminBypassEnabled: expect.any(Boolean),
    });
    expect(res.body.dailyByUser).toContainEqual({
      user_id: userId,
      email: 'spend-user@example.com',
      name: 'spend-user',
      spent_cents: 12,
    });
  });

  it('excludes spend from previous days in the per-user view but keeps it in the month', async () => {
    await seedSpend(userId, 7, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

    const res = await request(app)
      .get('/api/admin/spend')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.dailyByUser).toEqual([]);
    expect(res.body.monthlyTotalCents).toBe(7);
  });
});
