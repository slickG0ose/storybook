import prisma from '../db/prisma';
import { normalizeEmail } from './allowlist';

/**
 * One-time-per-boot convergence of `User.email` onto its normalized form
 * (spec: .code-captain/specs/admin-bootstrap/spec.md, Decisions 5 and 6).
 *
 * `POST /api/auth/register` stored the raw request value until this shipped, so
 * a row can hold `Nick@Gmail.com` while the fixed login path looks up
 * `nick@gmail.com` — a permanent 401 for that account. Normalising on write
 * alone would create exactly that lockout for rows that predate the fix, so the
 * two ship together: writes are normalized, and this converges what is already
 * stored.
 *
 * Self-limiting by construction. Once the table is converged the steady state
 * is one `findMany` and zero writes, on every boot, forever.
 *
 * Never merges rows, never deletes one, and never modifies a row it did not
 * elect. Best-effort at boot: a failure is logged, never fatal.
 */

export interface EmailBackfillResult {
  /** Emails rewritten this boot, as their NEW lowercase value. */
  normalized: string[];
  /** Groups that could not be fully normalized because two rows share an address. */
  collisions: Array<{
    normalizedEmail: string;
    /** The elected row, which now holds `normalizedEmail`. */
    keptId: string;
    /** Rows left exactly as they were — email, data, and tombstone state. */
    skipped: Array<{ id: string; email: string; deleted: boolean }>;
  }>;
}

interface UserRow {
  id: string;
  email: string;
  deleted_at: Date | null;
  created_at: Date;
}

/**
 * Election order within a colliding group: a live row beats a tombstoned row,
 * and between two live (or two tombstoned) rows the older `created_at` wins.
 *
 * Deterministic on purpose — the same table must elect the same row on every
 * boot, or the collision warning would name a different "kept" id each restart.
 * A live row wins so that restoring a tombstone can never take an address away
 * from an active account.
 */
function electRow(group: UserRow[]): UserRow {
  return [...group].sort((a, b) => {
    const aLive = a.deleted_at === null ? 0 : 1;
    const bLive = b.deleted_at === null ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    const byAge = a.created_at.getTime() - b.created_at.getTime();
    if (byAge !== 0) return byAge;
    // Same instant (SQLite stores milliseconds, and a seed can write two rows
    // inside one). Fall back to id so the election is still stable.
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Lowercase every `User.email` that is not already normalized.
 *
 * Collisions are resolved in application code BEFORE any write, so Prisma's
 * P2002 is never reached: the elected row is updated, the rest keep their
 * distinct stored values, and the unique index cannot be violated.
 */
export async function backfillUserEmails(): Promise<EmailBackfillResult> {
  // No `deleted_at` filter, and that is mandatory rather than a preference:
  // `User.email` is @unique and the index spans tombstones, so a tombstoned
  // `Nick@G.com` would block the lowercasing of a live `nick@g.com` with a
  // P2002 — a crash in exactly the case this exists to handle.
  const rows = await prisma.user.findMany({
    select: { id: true, email: true, deleted_at: true, created_at: true },
  });

  const groups = new Map<string, UserRow[]>();
  for (const row of rows) {
    const key = normalizeEmail(row.email);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const result: EmailBackfillResult = { normalized: [], collisions: [] };

  for (const [normalizedEmail, group] of groups) {
    if (group.length === 1) {
      const [row] = group;
      // The steady state: already normalized, nothing to write.
      if (row.email === normalizedEmail) continue;
      await prisma.user.update({
        where: { id: row.id },
        data: { email: normalizedEmail },
      });
      result.normalized.push(normalizedEmail);
      continue;
    }

    const kept = electRow(group);
    const skipped = group
      .filter(row => row.id !== kept.id)
      .map(row => ({ id: row.id, email: row.email, deleted: row.deleted_at !== null }));

    if (kept.email !== normalizedEmail) {
      await prisma.user.update({
        where: { id: kept.id },
        data: { email: normalizedEmail },
      });
      result.normalized.push(normalizedEmail);
    }

    // This service reports itself — the caller only handles failure, matching
    // reconcileAdmins(). The honest cost is stated in the spec: a non-elected
    // live row is no longer reachable via /login, and only a human can decide
    // whether to merge or drop it. /api/admin/users is the resolution path.
    console.warn(
      `[email-backfill] COLLISION on ${normalizedEmail}: kept ${kept.id} (${kept.email}), ` +
        `left untouched ${skipped.map(r => `${r.id} (${r.email}${r.deleted ? ', deleted' : ''})`).join(', ')}`,
    );

    result.collisions.push({ normalizedEmail, keptId: kept.id, skipped });
  }

  if (result.normalized.length > 0) {
    console.log(
      `[email-backfill] normalised ${result.normalized.length}: ${result.normalized.join(', ')}`,
    );
  }

  return result;
}
