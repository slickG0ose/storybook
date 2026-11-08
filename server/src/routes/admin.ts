import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  AdminBookListResponseSchema,
  AdminBookMutationResponseSchema,
  AdminBookFeaturedRequestSchema,
  AdminBookHeroEligibleRequestSchema,
  AdminBookHeroEligibleResponseSchema,
  AdminUserListResponseSchema,
  AdminUserRestoreResponseSchema,
  OrphanIllustrationListResponseSchema,
  OrphanDeleteResponseSchema,
  AllowlistResponseSchema,
  AllowlistAddRequestSchema,
  AllowlistDeleteResponseSchema,
  AllowedEmailSchema,
  AdminSpendResponseSchema,
  AdminFeedbackListQuerySchema,
  AdminFeedbackListResponseSchema,
  AdminFeedbackStatusRequestSchema,
  AdminFeedbackStatusResponseSchema,
  type AdminFeedbackItem,
  type AdminFeedbackStatusRequest,
  type AllowlistAddRequest,
  type AdminBookFeaturedRequest,
  type AdminBookHeroEligibleRequest,
  type Character,
} from '@storybook/shared';
import prisma from '../db/prisma';
import { countHeroFrames } from '../lib/heroPool';
import { getAuthUser, requireAdmin } from './auth';
import { validate } from '../middleware/validate';
import { normalizeEmail } from '../services/allowlist';
import { getStorage, isValidKey } from '../services/storage';
import {
  startOfUtcDay,
  startOfUtcMonth,
  dailyPerUserLimitCents,
  monthlyGlobalLimitCents,
  adminBypassEnabled,
} from '../services/spend';

const router = Router();


type BookRow = { characters_json?: string | null } & Record<string, unknown>;

function hydrateBook<T extends BookRow>(book: T): T & { characters: Character[] } {
  let characters: Character[] = [];
  if (book.characters_json) {
    try {
      const parsed = JSON.parse(book.characters_json) as unknown;
      if (Array.isArray(parsed)) characters = parsed as Character[];
    } catch {
      characters = [];
    }
  }
  return { ...book, characters };
}

interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: string;
  deleted_at: Date | null;
  created_at: Date;
}

function stripUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  deleted_at: Date | null;
  created_at: Date;
}): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    deleted_at: user.deleted_at,
    created_at: user.created_at,
  };
}

/**
 * Admin gate middleware. Distinguishes 401 (no auth) vs 403 (auth'd but not
 * admin). Mounted before per-route `validate(...)` so request-body shape is
 * never inspected for unauthenticated callers.
 */
async function adminGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = await getAuthUser(req);
  if (!authed) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  // Expose the admin to downstream handlers, matching requireAuth. Without
  // this, attributing an action to the admin who took it (e.g. allowlist
  // added_by) silently records null instead of failing loudly.
  res.locals.user = admin;
  next();
}

router.get(
  '/users',
  adminGate,
  validate({
    name: 'GET /api/admin/users',
    response: AdminUserListResponseSchema,
  }),
  async (_req: Request, res: Response) => {
    // Include soft-deleted rows: the whole point of the admin view is to see
    // and restore them.
    const users = await prisma.user.findMany({
      orderBy: { created_at: 'desc' },
    });

    res.json(users.map(stripUser));
  },
);

router.get(
  '/books',
  adminGate,
  validate({
    name: 'GET /api/admin/books',
    response: AdminBookListResponseSchema,
  }),
  async (_req: Request, res: Response) => {
    const books = await prisma.book.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        creator: { select: { email: true, name: true } },
      },
    });

    res.json(books.map(hydrateBook));
  },
);

router.put(
  '/users/:id/restore',
  adminGate,
  validate({
    name: 'PUT /api/admin/users/:id/restore',
    response: AdminUserRestoreResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const restored = await prisma.user.update({
      where: { id: req.params.id },
      data: { deleted_at: null },
    });

    res.json(stripUser(restored));
  },
);

router.put(
  '/books/:id/restore',
  adminGate,
  validate({
    name: 'PUT /api/admin/books/:id/restore',
    response: AdminBookMutationResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const book = await prisma.book.findUnique({ where: { id: req.params.id } });
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const restored = await prisma.book.update({
      where: { id: req.params.id },
      data: { deleted_at: null },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });

    res.json(hydrateBook(restored));
  },
);

router.put(
  '/books/:id/featured',
  adminGate,
  validate({
    name: 'PUT /api/admin/books/:id/featured',
    request: AdminBookFeaturedRequestSchema,
    response: AdminBookMutationResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const { is_featured } = req.body as AdminBookFeaturedRequest;

    const book = await prisma.book.findUnique({ where: { id: req.params.id } });
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const updated = await prisma.book.update({
      where: { id: req.params.id },
      data: { is_featured },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });

    res.json(hydrateBook(updated));
  },
);

/**
 * PUT /api/admin/books/:id/hero-eligible — the editorial flag behind the Home hero
 * rotation, and the operational lever for taking a book back out of it.
 *
 * Middleware order is `adminGate → validate → handler`, matching the featured route
 * above: auth must beat validation so a non-admin sending nonsense is told 403, not 400.
 *
 * **This route does not write `hero_consent_at`, and must not learn how.** An admin
 * saying "this is good enough for the front page" is editorial judgement; the book
 * owner agreeing to have their art advertised to strangers is consent. Two columns, two
 * writers — see `server/src/lib/heroPool.ts` and spec §"The consent seam". If wiring the
 * consent write in here would be convenient, that is the seam working.
 *
 * `hero_frames_available` is what makes this response more than the book: the flag alone
 * changes nothing until `server/scripts/derive-hero-frames.sh` has written the artifacts,
 * so a `0` here means "flagged, but nobody ran the derive script yet".
 */
router.put(
  '/books/:id/hero-eligible',
  adminGate,
  validate({
    name: 'PUT /api/admin/books/:id/hero-eligible',
    request: AdminBookHeroEligibleRequestSchema,
    response: AdminBookHeroEligibleResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const { is_hero_eligible } = req.body as AdminBookHeroEligibleRequest;

    const book = await prisma.book.findUnique({ where: { id: req.params.id } });
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const updated = await prisma.book.update({
      where: { id: req.params.id },
      // One column. Adding `hero_consent_at` to this payload is the mistake the whole
      // design exists to make hard.
      data: { is_hero_eligible },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });

    res.json({
      ...hydrateBook(updated),
      hero_frames_available: countHeroFrames(
        updated.id,
        updated.pages.map(page => page.page_number),
      ),
    });
  },
);

interface OrphanRow {
  path: string;
  book_exists: boolean;
  soft_deleted: boolean;
}

router.get(
  '/orphan-illustrations',
  adminGate,
  validate({
    name: 'GET /api/admin/orphan-illustrations',
    response: OrphanIllustrationListResponseSchema,
  }),
  async (_req: Request, res: Response) => {
    // Scanning at book granularity: a book's illustrations all live under
    // `<bookId>/`, so the first key segment is the book id. A top-level file
    // (no slash) is its own entry — it matches no book and is reported as an
    // orphan, which is a reasonable outcome. Under r2, list() merges the bucket
    // with local disk. An empty store is a non-error condition: nothing stored
    // means nothing to reconcile.
    const entries = [
      ...new Set((await getStorage().list('')).map(obj => obj.key.split('/')[0])),
    ];

    const orphans: OrphanRow[] = [];

    for (const entry of entries) {
      const book = await prisma.book.findUnique({ where: { id: entry } });
      if (!book) {
        orphans.push({
          path: `/illustrations/${entry}`,
          book_exists: false,
          soft_deleted: false,
        });
      } else if (book.deleted_at !== null) {
        // The book row exists but is tombstoned — surface it so the admin can
        // decide whether to restore the book or clean up the directory.
        orphans.push({
          path: `/illustrations/${entry}`,
          book_exists: true,
          soft_deleted: true,
        });
      }
      // Else: directory matches a live book row — not an orphan, skip.
    }

    res.json(orphans);
  },
);

router.delete(
  '/orphan-illustrations/:id',
  adminGate,
  validate({
    name: 'DELETE /api/admin/orphan-illustrations/:id',
    response: OrphanDeleteResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    // Key-shape guard, before touching storage. The storage seam owns key
    // validation (`..`, leading `/`, backslash, NUL, `.` segments); on top of
    // that an id is exactly one segment, so a `/` is refused here too. The
    // prefix passed to remove() is `${id}/` — remove() is a PREFIX match, and a
    // bare id would also delete every book whose id merely starts with it.
    const prefix = `${id}/`;
    if (id.includes('/') || !isValidKey(prefix)) {
      return res.status(400).json({ error: 'Invalid request: path traversal' });
    }

    const storage = getStorage();

    // 404 if nothing is stored under the id.
    if ((await storage.list(prefix)).length === 0) {
      return res.status(404).json({ error: 'Orphan directory not found' });
    }

    // 409 if the directory matches a *live* book row. (Soft-deleted books are
    // still considered orphan-of-orphan and may be cleaned up — matches the
    // listing semantics in GET /api/admin/orphan-illustrations.)
    const book = await prisma.book.findUnique({ where: { id } });
    if (book && book.deleted_at === null) {
      return res
        .status(409)
        .json({ error: 'Cannot delete: directory belongs to a live book' });
    }

    await storage.remove(prefix);
    res.json({ success: true, deleted: id });
  },
);

export default router;

// ---------------------------------------------------------------------------
// Registration allowlist (F4a / #5)
// ---------------------------------------------------------------------------

router.get(
  '/allowlist',
  adminGate,
  validate({
    name: 'GET /api/admin/allowlist',
    response: AllowlistResponseSchema,
  }),
  async (_req: Request, res: Response) => {
    const rows = await prisma.allowedEmail.findMany({ orderBy: { created_at: 'desc' } });
    res.json(rows);
  },
);

router.post(
  '/allowlist',
  adminGate,
  validate({
    name: 'POST /api/admin/allowlist',
    request: AllowlistAddRequestSchema,
    response: AllowedEmailSchema,
  }),
  async (req: Request, res: Response) => {
    const { email, note } = req.body as AllowlistAddRequest;
    const admin = res.locals.user as { email: string } | undefined;
    const normalized = normalizeEmail(email);

    const existing = await prisma.allowedEmail.findUnique({ where: { email: normalized } });
    if (existing) {
      return res.status(409).json({ error: 'That email is already on the allowlist' });
    }

    const row = await prisma.allowedEmail.create({
      data: {
        email: normalized,
        added_by: admin?.email ?? null,
        note: note?.trim() || null,
      },
    });

    res.status(201).json(row);
  },
);

router.delete(
  '/allowlist/:email',
  adminGate,
  validate({
    name: 'DELETE /api/admin/allowlist/:email',
    response: AllowlistDeleteResponseSchema,
  }),
  async (req: Request<{ email: string }>, res: Response) => {
    const normalized = normalizeEmail(req.params.email);

    const existing = await prisma.allowedEmail.findUnique({ where: { email: normalized } });
    if (!existing) {
      return res.status(404).json({ error: 'That email is not on the allowlist' });
    }

    // Removing an email from the allowlist does NOT delete or disable an
    // account that already registered with it — it only prevents a NEW
    // registration. Use the soft-delete user endpoints to revoke access.
    await prisma.allowedEmail.delete({ where: { email: normalized } });

    res.json({ success: true, removed: normalized });
  },
);

// ---------------------------------------------------------------------------
// Spend gates dashboard (F4b / #6)
// ---------------------------------------------------------------------------

router.get(
  '/spend',
  adminGate,
  validate({
    name: 'GET /api/admin/spend',
    response: AdminSpendResponseSchema,
  }),
  async (_req: Request, res: Response) => {
    const now = new Date();

    const [dailyGroups, monthlyAgg] = await Promise.all([
      prisma.usageLog.groupBy({
        by: ['user_id'],
        where: { created_at: { gte: startOfUtcDay(now) } },
        _sum: { cost_cents: true },
      }),
      prisma.usageLog.aggregate({
        _sum: { cost_cents: true },
        where: { created_at: { gte: startOfUtcMonth(now) } },
      }),
    ]);

    // Resolve names in one query rather than per row. A UsageLog row can
    // outlive its user (hard-deleted test rows), so email/name are nullable
    // rather than assuming the join always lands.
    const users = await prisma.user.findMany({
      where: { id: { in: dailyGroups.map(g => g.user_id) } },
      select: { id: true, email: true, name: true },
    });
    const byId = new Map(users.map(u => [u.id, u]));

    res.json({
      dailyByUser: dailyGroups
        .map(g => ({
          user_id: g.user_id,
          email: byId.get(g.user_id)?.email ?? null,
          name: byId.get(g.user_id)?.name ?? null,
          spent_cents: g._sum.cost_cents ?? 0,
        }))
        .sort((a, b) => b.spent_cents - a.spent_cents),
      monthlyTotalCents: monthlyAgg._sum.cost_cents ?? 0,
      dailyLimitCents: dailyPerUserLimitCents(),
      monthlyLimitCents: monthlyGlobalLimitCents(),
      adminBypassEnabled: adminBypassEnabled(),
    });
  },
);

// ---------------------------------------------------------------------------
// Tester feedback triage (#157, spec .code-captain/specs/tester-feedback-widget/)
//
// The tester-facing POST lives in routes/feedback.ts. These two are the admin side:
// list (newest first, optional status / user filters) and move a report along
// new → triaged → done. Both are adminGate → validate → handler, so a non-admin
// with a bad body is told 403, never 400.
// ---------------------------------------------------------------------------

const FEEDBACK_LIST_LIMIT = 200;

const feedbackInclude = {
  user: { select: { email: true, name: true } },
  book: { select: { title: true } },
} as const;

type FeedbackRow = {
  id: string;
  user_id: string;
  session_id: string;
  category: string;
  message: string;
  route: string;
  book_id: string | null;
  user_agent: string | null;
  viewport_width: number;
  viewport_height: number;
  theme: string;
  client_build: string | null;
  server_build: string | null;
  recent_errors_json: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  user: { email: string; name: string };
  book: { title: string } | null;
};

/**
 * Null, unparseable, or non-array JSON all read as []. A malformed column must never
 * take the whole triage list down with it; non-string entries are dropped.
 */
function parseRecentErrors(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

/** The one row → wire mapping, shared by the list and the status PATCH. */
function toAdminFeedbackItem(row: FeedbackRow): AdminFeedbackItem {
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.user.email,
    user_name: row.user.name,
    session_id: row.session_id,
    // category / theme / status are free strings in Prisma (SQLite has no enums);
    // the response validator still checks them against the shared enums.
    category: row.category as AdminFeedbackItem['category'],
    message: row.message,
    route: row.route,
    book_id: row.book_id,
    book_title: row.book?.title ?? null,
    user_agent: row.user_agent,
    viewport_width: row.viewport_width,
    viewport_height: row.viewport_height,
    theme: row.theme as AdminFeedbackItem['theme'],
    client_build: row.client_build,
    server_build: row.server_build,
    recent_errors: parseRecentErrors(row.recent_errors_json),
    status: row.status as AdminFeedbackItem['status'],
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

router.get(
  '/feedback',
  adminGate,
  validate({
    name: 'GET /api/admin/feedback',
    response: AdminFeedbackListResponseSchema,
  }),
  async (req: Request, res: Response) => {
    // validate() only covers bodies, so the query is parsed here.
    const query = AdminFeedbackListQuerySchema.safeParse(req.query);
    if (!query.success) {
      const summary = query.error.issues
        .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return res.status(400).json({ error: `Invalid query: ${summary}` });
    }

    const { status, user_id } = query.data;
    const rows = await prisma.feedback.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(user_id ? { user_id } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: FEEDBACK_LIST_LIMIT,
      include: feedbackInclude,
    });

    res.json(rows.map(toAdminFeedbackItem));
  },
);

router.patch(
  '/feedback/:id',
  adminGate,
  validate({
    name: 'PATCH /api/admin/feedback/:id',
    request: AdminFeedbackStatusRequestSchema,
    response: AdminFeedbackStatusResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const { status } = req.body as AdminFeedbackStatusRequest;

    const existing = await prisma.feedback.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Feedback not found.' });
    }

    const updated = await prisma.feedback.update({
      where: { id: req.params.id },
      data: { status },
      include: feedbackInclude,
    });

    res.json(toAdminFeedbackItem(updated));
  },
);
