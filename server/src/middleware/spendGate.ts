import { checkQuota } from '../services/spend';
import type { QuotaDecision, UsageKind } from '../services/spend';
import type { Request, Response, NextFunction } from 'express';

/**
 * Write the quota-denied envelope. Exported so a handler-level `checkQuota`
 * (the routes that must price at the book's *pinned* provider, which the
 * middleware cannot know) answers with byte-identical status codes, headers and
 * body to this gate. Two hand-rolled copies of this envelope would drift, and
 * the client parses `quota.scope` to decide what to say.
 */
export function sendQuotaDenied(res: Response, decision: QuotaDecision): void {
  if (decision.reason === 'monthly') {
    res.status(503).json({
      error:
        'This project has reached its monthly AI spending limit. Generation is paused until next month.',
      quota: {
        scope: 'monthly',
        spentCents: decision.globalSpentCents,
        limitCents: decision.monthlyLimitCents,
      },
    });
    return;
  }

  const secondsUntilUtcMidnight = Math.max(
    1,
    Math.ceil((startOfNextUtcDay().getTime() - Date.now()) / 1000),
  );
  res.setHeader('Retry-After', String(secondsUntilUtcMidnight));
  res.status(429).json({
    error: "You've reached your daily generation limit. It resets at midnight UTC.",
    quota: {
      scope: 'daily',
      spentCents: decision.userSpentCents,
      limitCents: decision.dailyLimitCents,
    },
  });
}

/**
 * Spend gate (F4b / #6). Mount AFTER requireAuth — it needs `res.locals.user`.
 *
 * Status codes carry meaning here:
 *  - **429** the caller personally hit today's cap. Their problem, resets
 *    tomorrow, and `Retry-After` points at the UTC rollover.
 *  - **503** the project hit its monthly ceiling. Nobody gets served, admins
 *    included — this is the ceiling that protects the bill, so it is not
 *    bypassable. 503 rather than 429 because it isn't the caller's fault and
 *    retrying sooner won't help.
 *
 * This gate only reserves the *first* unit of work for a request. Routes that
 * loop over several paid calls (e.g. bulk illustrate) must re-check per
 * iteration; see `checkQuota`/`recordUsage` usage in books.ts.
 *
 * It also reserves at the DEFAULT rate, never the provider-aware one: it runs
 * before the book is loaded, so the book's image pin isn't known yet and an
 * openai-pinned image is reserved here at 4c rather than 25c. That is fine and
 * deliberate — the handler's per-iteration `checkQuota(..., provider)` prices
 * the call correctly and runs before any provider call, so nothing paid gets
 * through underpriced. Don't move pin resolution into the middleware to "fix"
 * it; that would mean loading the book twice on every metered request.
 */
export function spendGate(kind: UsageKind) {
  return async function spendGateMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const user = res.locals.user as { id: string; role?: string } | undefined;
    if (!user) {
      // Mounted without requireAuth in front of it. Fail closed rather than
      // silently letting an unmetered request through.
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const decision = await checkQuota(user.id, kind, user.role === 'admin');

    if (decision.allowed) {
      next();
      return;
    }

    sendQuotaDenied(res, decision);
  };
}

function startOfNextUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
