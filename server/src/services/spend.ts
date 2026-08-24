import prisma from '../db/prisma';
import type { ImageProvider } from './imagePin';

/**
 * Spend gates (F4b / #6).
 *
 * Two independent ceilings, because they protect against different failure
 * modes:
 *
 *  - **Per-user daily** — one account going wild, whether by enthusiasm or by
 *    a compromised token. Recoverable: it resets tomorrow, and an admin can be
 *    allowed past it.
 *  - **Global monthly** — the project's total bill. This is the one that
 *    actually protects the credit card, so it is NOT admin-bypassable. An
 *    admin burning through the monthly ceiling spends exactly the same money
 *    as anyone else.
 *
 * Usage is recorded AFTER a paid call succeeds (see `recordUsage`), so a
 * failed request doesn't consume quota. The trade-off is that a call which
 * succeeds upstream but fails before we log it goes uncounted — undercounting
 * on error is preferable to charging users for work they didn't get.
 */

export type UsageKind = 'story' | 'illustration' | 'cover';

/**
 * Cost per call in whole cents.
 *
 * Deliberately coarse. These are budget-guard estimates, not billing: the
 * point is to stop runaway spend, and a gate that is roughly right and always
 * enforced beats an exact one that drifts against provider pricing. Image
 * costs assume Fal Flux at ~$0.04/image (ADR-006/007). Revisit if the provider
 * or model changes.
 */
export const COST_CENTS: Record<UsageKind, number> = {
  // A 15-page story runs ~4K output tokens; at Sonnet's $15/M output that is
  // ~6c, not the 3c originally estimated. The old figure made the daily cap
  // roughly twice as permissive for story calls as intended.
  story: 6,
  illustration: 4,
  cover: 4,
};

/**
 * Cost of one image generated on OpenAI, in whole cents.
 *
 * `gpt-image-1` runs ~$0.17–0.45/image (ADR-006) against Fal's flat ~$0.04.
 * Pinning legacy books to their original provider makes those calls reachable
 * again, and charging them at `COST_CENTS.illustration` would undercount by
 * 4–11x — a spend guard that under-estimates is not a guard. 25c is the mid of
 * that range, ruled by the repo owner on 2026-08-23 (ADR-013). Deliberately
 * coarse, like `COST_CENTS` itself: this is a budget guard, not billing.
 */
export const OPENAI_IMAGE_COST_CENTS = 25;

/**
 * Price one call. `provider` only matters for image kinds — text generation
 * runs on Claude regardless of which image provider a book is pinned to.
 *
 * Every caller that meters a call MUST price it through here, so `checkQuota`
 * and `recordUsage` can never disagree about what a call cost: a check at 25c
 * followed by a record at 4c would leak 21c per image past the monthly ceiling.
 */
export function costCentsFor(kind: UsageKind, provider?: ImageProvider): number {
  if (provider === 'openai' && (kind === 'illustration' || kind === 'cover')) {
    return OPENAI_IMAGE_COST_CENTS;
  }
  return COST_CENTS[kind];
}

const DEFAULT_DAILY_PER_USER_CENTS = 50;
const DEFAULT_MONTHLY_GLOBAL_CENTS = 2000;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  // A malformed limit must not silently disable the gate, so fall back to the
  // default rather than to Infinity or NaN.
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function dailyPerUserLimitCents(): number {
  return readIntEnv('QUOTA_DAILY_PER_USER_CENTS', DEFAULT_DAILY_PER_USER_CENTS);
}

export function monthlyGlobalLimitCents(): number {
  return readIntEnv('QUOTA_MONTHLY_GLOBAL_CENTS', DEFAULT_MONTHLY_GLOBAL_CENTS);
}

/** Admins may exceed the per-user daily cap. Defaults to true; never applies to the monthly ceiling. */
export function adminBypassEnabled(): boolean {
  return (process.env.QUOTA_ADMIN_BYPASS ?? 'true').toLowerCase() !== 'false';
}

/**
 * Window boundaries in UTC.
 *
 * UTC rather than server-local so the reset point doesn't move with the host's
 * timezone or DST — a quota that silently shifts by an hour twice a year is a
 * support ticket nobody can reproduce.
 */
export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function sumCents(where: Record<string, unknown>): Promise<number> {
  const result = await prisma.usageLog.aggregate({
    _sum: { cost_cents: true },
    where,
  });
  return result._sum.cost_cents ?? 0;
}

export async function userSpendTodayCents(userId: string, now: Date = new Date()): Promise<number> {
  return sumCents({ user_id: userId, created_at: { gte: startOfUtcDay(now) } });
}

export async function globalSpendThisMonthCents(now: Date = new Date()): Promise<number> {
  return sumCents({ created_at: { gte: startOfUtcMonth(now) } });
}

export interface QuotaDecision {
  allowed: boolean;
  /** Which ceiling stopped it. Maps to 429 (daily) vs 503 (monthly). */
  reason?: 'daily' | 'monthly';
  costCents: number;
  userSpentCents: number;
  globalSpentCents: number;
  dailyLimitCents: number;
  monthlyLimitCents: number;
}

/**
 * Decide whether one more call of `kind` fits under both ceilings.
 *
 * Checks the monthly ceiling FIRST so an admin bypassing their daily cap still
 * gets stopped by the global one — the bypass must never be able to reorder
 * itself past the ceiling that protects the bill.
 *
 * `provider` is optional and additive: omitting it prices at the default table,
 * which is what `spendGate` does (it runs before the book — and therefore the
 * pin — is known, so it can only reserve at the default rate). The handler's
 * per-iteration `checkQuota` with the resolved provider is the real gate, and
 * it runs before any provider call. Pass the same provider to `recordUsage`.
 */
export async function checkQuota(
  userId: string,
  kind: UsageKind,
  isAdmin: boolean,
  now: Date = new Date(),
  provider?: ImageProvider,
): Promise<QuotaDecision> {
  const costCents = costCentsFor(kind, provider);
  const dailyLimitCents = dailyPerUserLimitCents();
  const monthlyLimitCents = monthlyGlobalLimitCents();

  const [userSpentCents, globalSpentCents] = await Promise.all([
    userSpendTodayCents(userId, now),
    globalSpendThisMonthCents(now),
  ]);

  const base = {
    costCents,
    userSpentCents,
    globalSpentCents,
    dailyLimitCents,
    monthlyLimitCents,
  };

  if (globalSpentCents + costCents > monthlyLimitCents) {
    return { allowed: false, reason: 'monthly', ...base };
  }

  const bypassesDaily = isAdmin && adminBypassEnabled();
  if (!bypassesDaily && userSpentCents + costCents > dailyLimitCents) {
    return { allowed: false, reason: 'daily', ...base };
  }

  return { allowed: true, ...base };
}

/**
 * Record a completed paid call. Call only after the provider call succeeds.
 *
 * Pass the SAME `provider` that was passed to the `checkQuota` which authorised
 * the call. Checking at one price and recording at another lets the difference
 * escape both ceilings, one call at a time.
 */
export async function recordUsage(
  userId: string,
  kind: UsageKind,
  provider?: ImageProvider,
): Promise<void> {
  await prisma.usageLog.create({
    data: { user_id: userId, kind, cost_cents: costCentsFor(kind, provider) },
  });
}
