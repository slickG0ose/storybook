import { Router } from 'express';
import { readdir, rm, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import type { Request, Response, NextFunction } from 'express';
import {
  AdminBookListResponseSchema,
  AdminBookMutationResponseSchema,
  AdminBookFeaturedRequestSchema,
  AdminUserListResponseSchema,
  AdminUserRestoreResponseSchema,
  OrphanIllustrationListResponseSchema,
  OrphanDeleteResponseSchema,
  type AdminBookFeaturedRequest,
  type Character,
} from '@storybook/shared';
import prisma from '../db/prisma';
import { getAuthUser, requireAdmin } from './auth';
import { validate } from '../middleware/validate';

const router = Router();

const ILLUSTRATIONS_DIR = join(import.meta.dirname, '../../public/illustrations');

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
    let entries: string[];
    try {
      entries = await readdir(ILLUSTRATIONS_DIR);
    } catch {
      // Directory missing is a non-error condition: nothing on disk means
      // nothing to reconcile.
      return res.json([]);
    }

    const orphans: OrphanRow[] = [];

    for (const entry of entries) {
      // Scanning at directory granularity — each book gets its own folder.
      // We don't `stat` here because readdir on Windows can be slow for a lot
      // of entries; a non-directory file would just match no book and be
      // reported as an orphan, which is also a reasonable outcome.
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

    // Path-traversal guard. Reject any `id` containing path separators or `..`
    // *before* hitting the filesystem. Then resolve and verify the result is
    // still strictly inside ILLUSTRATIONS_DIR — defense in depth in case a
    // future refactor weakens the surface check.
    if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
      return res.status(400).json({ error: 'Invalid request: path traversal' });
    }

    const illustrationsRoot = resolve(ILLUSTRATIONS_DIR);
    const targetPath = resolve(illustrationsRoot, id);
    // The resolved target MUST be a direct child of illustrationsRoot. We
    // require the prefix + separator so `/foo/illustrations` doesn't match
    // `/foo/illustrations-evil`.
    if (
      targetPath === illustrationsRoot ||
      !targetPath.startsWith(illustrationsRoot + sep)
    ) {
      return res.status(400).json({ error: 'Invalid request: path traversal' });
    }

    // 404 if the directory doesn't exist on disk.
    try {
      const s = await stat(targetPath);
      if (!s.isDirectory()) {
        return res.status(404).json({ error: 'Orphan directory not found' });
      }
    } catch {
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

    await rm(targetPath, { recursive: true, force: true });
    res.json({ success: true, deleted: id });
  },
);

export default router;
