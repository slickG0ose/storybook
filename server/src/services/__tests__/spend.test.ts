import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { spendGate } from '../../middleware/spendGate';
import {
  COST_CENTS,
  NARRATION_CENTS_PER_1K_CHARS,
  OPENAI_IMAGE_COST_CENTS,
  costCentsFor,
  checkQuota,
  recordUsage,
  userSpendTodayCents,
} from '../spend';

// `UsageLog.user_id` carries no foreign key, so a bare id is enough to meter
// against — no registration round trip needed for pure spend arithmetic.
const USER_ID = 'narration-spend-user';

async function seedSpend(userId: string, cents: number): Promise<void> {
  await prisma.usageLog.create({ data: { user_id: userId, kind: 'story', cost_cents: cents } });
}

describe("costCentsFor('narration') — char pricing", () => {
  it('pins the configured rate and floor', () => {
    expect(NARRATION_CENTS_PER_1K_CHARS).toBe(2);
    expect(COST_CENTS.narration).toBe(1);
  });

  it.each([
    [0, 1],
    [220, 1],
    [500, 1],
    [501, 2],
    [1000, 2],
    [1001, 3],
  ])('%i chars -> %i cents', (chars, cents) => {
    expect(costCentsFor('narration', undefined, chars)).toBe(cents);
  });

  it('prices at the 1c floor when chars is omitted (the spendGate reservation)', () => {
    expect(costCentsFor('narration')).toBe(1);
  });

  it('leaves image kinds unchanged with and without chars', () => {
    for (const kind of ['illustration', 'cover'] as const) {
      expect(costCentsFor(kind)).toBe(COST_CENTS[kind]);
      expect(costCentsFor(kind, undefined, 5000)).toBe(COST_CENTS[kind]);
      expect(costCentsFor(kind, 'fal', 5000)).toBe(COST_CENTS[kind]);
      expect(costCentsFor(kind, 'openai', 5000)).toBe(OPENAI_IMAGE_COST_CENTS);
    }
  });
});

describe("checkQuota / recordUsage — 'narration'", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([220, 1001, 4321])('agree on what %i chars cost', async (chars) => {
    const decision = await checkQuota(USER_ID, 'narration', false, new Date(), undefined, chars);
    expect(decision.allowed).toBe(true);
    expect(decision.costCents).toBe(costCentsFor('narration', undefined, chars));

    await recordUsage(USER_ID, 'narration', undefined, chars);
    expect(await userSpendTodayCents(USER_ID)).toBe(decision.costCents);

    const row = await prisma.usageLog.findFirstOrThrow({ where: { user_id: USER_ID } });
    expect(row.kind).toBe('narration');
  });

  it('gates on the char-priced cost, not the floor', async () => {
    // 3c of headroom: a 1,000-char page (2c) fits, a 1,001-char page (3c)
    // fits exactly, a 1,501-char page (4c) does not.
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '3');
    expect((await checkQuota(USER_ID, 'narration', false, new Date(), undefined, 1000)).allowed).toBe(true);
    expect((await checkQuota(USER_ID, 'narration', false, new Date(), undefined, 1001)).allowed).toBe(true);

    const over = await checkQuota(USER_ID, 'narration', false, new Date(), undefined, 1501);
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe('daily');
  });
});

describe("spendGate('narration')", () => {
  function gatedApp() {
    const app = express();
    app.use((_req, res, next) => {
      res.locals.user = { id: USER_ID, role: 'user' };
      next();
    });
    app.post('/gated', spendGate('narration'), (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reserves exactly 1c: passes with 1c of headroom, 429s with none', async () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '5');
    await seedSpend(USER_ID, 4);
    await request(gatedApp()).post('/gated').expect(200);

    await seedSpend(USER_ID, 1);
    const res = await request(gatedApp()).post('/gated').expect(429);
    expect(res.body).toMatchObject({ quota: { scope: 'daily', spentCents: 5, limitCents: 5 } });
  });

  it('records nothing itself — only the handler meters', async () => {
    await request(gatedApp()).post('/gated').expect(200);
    expect(await userSpendTodayCents(USER_ID)).toBe(0);
  });
});
