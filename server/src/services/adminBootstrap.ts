import prisma from '../db/prisma';
import { normalizeEmail, parseEmailList } from './allowlist';

/**
 * Env-driven admin promotion (spec: .code-captain/specs/admin-bootstrap/spec.md).
 *
 * `ADMIN_BOOTSTRAP_EMAILS` is the source of truth for who holds `role: 'admin'`,
 * and it is RECONCILED ON EVERY BOOT — not seeded once. This is the one place
 * the design deliberately diverges from `bootstrapAllowlist()`, whose
 * "only when the table is empty" guard is unavailable here: the `User` table is
 * never empty once anyone registers.
 *
 * Consequence, stated plainly: an admin promoted by hand (psql, or a local
 * `demo-seed.ts` run) is demoted on the next boot whenever the var is set. That
 * is intended. Leave the var UNSET in local `.env` — unset is a total no-op and
 * leaves the seeded `demo@storybook.local` admin alone.
 *
 * Three guards keep a fat-fingered dashboard edit from locking everyone out:
 *   1. unset or blank            -> total no-op, zero writes
 *   2. set but nothing parseable -> total no-op, zero writes, one console.warn
 *   3. demotion writes `role: 'user'` and nothing else — account, books,
 *      orders, and token survive. Re-add the email, restart, admin is back.
 *
 * Because 1 and 2 make "clear the var" a no-op, reaching zero admins needs the
 * explicit `none` sentinel below.
 *
 * This never creates a user row. The operator flow is: list the address, the
 * person registers normally with their own password, the next boot promotes
 * them. No password ever appears in config.
 */

export interface AdminBootstrapResult {
  /** Emails whose role went user -> admin this boot. */
  promoted: string[];
  /** Emails whose role went admin -> user this boot. */
  demoted: string[];
  /** Listed emails with no live (deleted_at: null) user row. */
  missing: string[];
  /** True when the var was absent, blank, or unparseable: zero writes. */
  skipped: boolean;
}

/**
 * Sentinel: demote every admin, promote nobody. Not a valid address, so it
 * cannot collide with a real one, and it survives `normalizeEmail` unchanged.
 */
export const DEMOTE_ALL_SENTINEL = 'none';

/**
 * Reconcile `User.role` against `ADMIN_BOOTSTRAP_EMAILS`.
 *
 * Matching is done in APPLICATION CODE, not in the `where` clause, because
 * stored emails are not normalized: `POST /api/auth/register` writes the raw
 * request value, so `User.email` can hold `Nick@Gmail.com`. A plain
 * `where: { email: { in: [...] } }` over lowercased addresses would silently
 * miss exactly the admin it was meant to promote. Prisma's
 * `mode: 'insensitive'` is not an option either — it is Postgres-only and would
 * break the SQLite dev/test path. So: read the candidate rows, compare
 * `normalizeEmail(row.email)` in JS, and drive both `updateMany` calls by id.
 * That stays correct whether or not the auth path is later fixed to normalize
 * on write.
 */
export async function reconcileAdmins(): Promise<AdminBootstrapResult> {
  const raw = process.env.ADMIN_BOOTSTRAP_EMAILS;

  // Guard 1 — unset or blank means "this deployment does not manage admins
  // here". No DB access at all.
  if (!raw?.trim()) {
    return { promoted: [], demoted: [], missing: [], skipped: true };
  }

  // The sentinel is checked before parsing: `none` has no '@' and would
  // otherwise be filtered out by parseEmailList and land in guard 2.
  const isSentinel = normalizeEmail(raw) === DEMOTE_ALL_SENTINEL;
  const emails = isSentinel ? [] : parseEmailList(raw);

  // Guard 2 — set, but a typo rather than an instruction to clear the admin
  // set. Refusing to act is what stops `,,` from mass-demoting everyone.
  if (!isSentinel && emails.length === 0) {
    console.warn(
      '[admin-bootstrap] ADMIN_BOOTSTRAP_EMAILS is set but contains no usable address; ' +
        'no roles changed. Use ADMIN_BOOTSTRAP_EMAILS=none to demote every admin.',
    );
    return { promoted: [], demoted: [], missing: [], skipped: true };
  }

  const targets = new Set(emails);

  // Candidates: every live user (promotion + missing) plus every admin row,
  // including soft-deleted ones (demotion). Demotion deliberately ignores
  // `deleted_at` — leaving a tombstoned row with `role: 'admin'` would hand
  // back admin the moment someone restored the account. The table is small
  // (demo-grade product) and case-insensitive matching has to happen in JS
  // anyway, so this reads rows rather than filtering by email in SQL.
  const rows = await prisma.user.findMany({
    where: { OR: [{ deleted_at: null }, { role: 'admin' }] },
    select: { id: true, email: true, role: true, deleted_at: true },
  });

  const promoteRows = rows.filter(
    r => r.deleted_at === null && r.role !== 'admin' && targets.has(normalizeEmail(r.email)),
  );
  const demoteRows = rows.filter(
    r => r.role === 'admin' && !targets.has(normalizeEmail(r.email)),
  );

  const liveEmails = new Set(
    rows.filter(r => r.deleted_at === null).map(r => normalizeEmail(r.email)),
  );
  const missing = emails.filter(e => !liveEmails.has(e));

  if (promoteRows.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: promoteRows.map(r => r.id) } },
      data: { role: 'admin' },
    });
  }
  if (demoteRows.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: demoteRows.map(r => r.id) } },
      data: { role: 'user' },
    });
  }

  // Reported normalized, matching the form used for comparison, so a log line
  // can be pasted straight back into the env var.
  const promoted = promoteRows.map(r => normalizeEmail(r.email));
  const demoted = demoteRows.map(r => normalizeEmail(r.email));

  if (promoted.length > 0) {
    console.log(`[admin-bootstrap] promoted ${promoted.length}: ${promoted.join(', ')}`);
  }
  if (demoted.length > 0) {
    console.log(`[admin-bootstrap] demoted ${demoted.length}: ${demoted.join(', ')}`);
  }
  // Expected steady state between setting the var and the person registering,
  // so this is information, not an error. Retried free on the next boot.
  if (missing.length > 0) {
    console.log(
      `[admin-bootstrap] ${missing.length} listed address(es) have no account yet: ${missing.join(', ')}`,
    );
  }

  return { promoted, demoted, missing, skipped: false };
}
