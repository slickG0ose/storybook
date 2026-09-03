import prisma from '../db/prisma';

/**
 * Registration allowlist (F4a / #5).
 *
 * Registration is closed by default: an email must be on the `AllowedEmail`
 * table to create an account. This is the layer that decides *who* can get an
 * account at all; the spend gates (#6) decide how much an account can then
 * spend. Neither substitutes for the other.
 *
 * Emails are compared case-insensitively and stored lowercased — addresses are
 * case-insensitive in practice, and storing mixed case would let the same
 * person be both allowed and blocked depending on how they typed it.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function isEmailAllowed(email: string): Promise<boolean> {
  const row = await prisma.allowedEmail.findUnique({
    where: { email: normalizeEmail(email) },
  });
  return row !== null;
}

/**
 * Parse a comma-separated env var into a de-duplicated list of normalized
 * addresses.
 *
 * Shared by `bootstrapAllowlist()` here and by `reconcileAdmins()` in
 * `adminBootstrap.ts` so there is exactly one definition of "what counts as a
 * listed address". The `includes('@')` filter is deliberately loose — it is
 * there to drop typos and stray separators (`,,`, `not-an-email`), not to
 * validate deliverability.
 */
export function parseEmailList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map(normalizeEmail)
        .filter(e => e.length > 0 && e.includes('@')),
    ),
  );
}

/**
 * Seed the allowlist from ALLOWLIST_BOOTSTRAP_EMAILS (comma-separated) when it
 * is empty.
 *
 * Only runs against an empty table, so it can't silently re-add an email an
 * admin deliberately removed — the bootstrap exists to solve "nobody can
 * register yet", not to keep enforcing an env var forever.
 *
 * Returns the emails actually inserted, for logging.
 */
export async function bootstrapAllowlist(): Promise<string[]> {
  const raw = process.env.ALLOWLIST_BOOTSTRAP_EMAILS;
  if (!raw?.trim()) return [];

  const existing = await prisma.allowedEmail.count();
  if (existing > 0) return [];

  const emails = parseEmailList(raw);
  if (emails.length === 0) return [];

  await prisma.allowedEmail.createMany({
    data: emails.map(email => ({
      email,
      added_by: 'ALLOWLIST_BOOTSTRAP_EMAILS',
      note: 'Seeded on server start because the allowlist was empty.',
    })),
  });

  return emails;
}
