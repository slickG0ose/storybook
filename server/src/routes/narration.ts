import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  NARRATION_VOICES,
  NarrationGenerateRequestSchema,
  NarrationGenerateResponseSchema,
  NarrationGetResponseSchema,
  NarrationSlotSchema,
  NarrationVoiceIdSchema,
  NarrationVoicesResponseSchema,
  type NarrationGenerateRequest,
  type NarrationSlot,
} from '@storybook/shared';
import prisma from '../db/prisma';
import { getAuthUser } from './auth';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/requireAuth';
import { spendGate, sendQuotaDenied } from '../middleware/spendGate';
import { findNarration, generateNarration, type NarrationBook } from '../services/narration/narration';
import { isNarrationConfigured } from '../services/narration/synthesizer';

/**
 * Generated narration routes (generated-narration spec, Task 6).
 *
 *  - `narrationRouter`      → mounted at `/api/narration`: the public voice catalog.
 *  - `bookNarrationRouter`  → mounted at `/api/books`: read (free) and generate (paid).
 *
 * The book routes live here rather than in `books.ts` to keep that file from
 * growing. They only declare `/:id/narration`, a two-segment path, so they can
 * never shadow `GET /api/books/:id` whichever router is mounted first.
 *
 * Neither book route accepts text. What gets spoken is always derived on the
 * server by `narrationTextFor(book, slot)` inside the service.
 */

export const narrationRouter = Router();
export const bookNarrationRouter = Router();

const BOOK_NOT_FOUND = { error: 'Book not found' } as const;

narrationRouter.get(
  '/voices',
  validate({ name: 'GET /api/narration/voices', response: NarrationVoicesResponseSchema }),
  (_req: Request, res: Response) => {
    res.json({ available: isNarrationConfigured(), voices: NARRATION_VOICES });
  },
);

/** `'cover'`, `'end'`, or a run of digits (a page number). Anything else is a 400. */
function parseSlotQuery(raw: unknown): NarrationSlot | null {
  if (typeof raw !== 'string') return null;
  const candidate: unknown = /^\d+$/.test(raw) ? Number(raw) : raw;
  const parsed = NarrationSlotSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Load a book the caller may read, with pages. Same rule as `GET /api/books/:id`:
 * soft-deleted is never visible, a draft only to its creator. Null → 404.
 */
async function loadVisibleBook(
  bookId: string,
  viewerId: string | null,
): Promise<NarrationBook | null> {
  const book = await prisma.book.findFirst({
    where: { id: bookId, deleted_at: null },
    include: { pages: { orderBy: { page_number: 'asc' } } },
  });
  if (!book) return null;
  if (book.status === 'draft' && (viewerId === null || viewerId !== book.created_by)) return null;
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    pages: book.pages.map((p) => ({ page_number: p.page_number, text: p.text })),
  };
}

// Free. No requireAuth: a signed-out reader hears any page someone already
// generated. getAuthUser is consulted only for draft visibility. Never calls
// the synthesizer and never touches spend.
bookNarrationRouter.get(
  '/:id/narration',
  validate({ name: 'GET /api/books/:id/narration', response: NarrationGetResponseSchema }),
  async (req: Request<{ id: string }>, res: Response) => {
    const voice = NarrationVoiceIdSchema.safeParse(req.query.voice);
    const slot = parseSlotQuery(req.query.slot);
    if (!voice.success || slot === null) {
      res.status(400).json({
        error: "Invalid query: expected voice=<voice id> and slot=<'cover' | 'end' | page number>",
      });
      return;
    }

    const user = await getAuthUser(req);
    const book = await loadVisibleBook(req.params.id, user?.id ?? null);
    if (!book) {
      res.status(404).json(BOOK_NOT_FOUND);
      return;
    }

    const clip = await findNarration(book, slot, voice.data);
    res.json(clip ?? { status: 'missing' });
  },
);

// Paid. Order is load-bearing: 401 beats 429 beats 400 (see server.md).
// Any signed-in reader of a readable book may generate; the requester is billed.
bookNarrationRouter.post(
  '/:id/narration',
  requireAuth,
  spendGate('narration'),
  validate({
    name: 'POST /api/books/:id/narration',
    request: NarrationGenerateRequestSchema,
    response: NarrationGenerateResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const user = res.locals.user as { id: string; role?: string };
    const { voiceId, slot } = req.body as NarrationGenerateRequest;

    const book = await loadVisibleBook(req.params.id, user.id);
    if (!book) {
      res.status(404).json(BOOK_NOT_FOUND);
      return;
    }

    if (!isNarrationConfigured()) {
      res.status(501).json({ error: 'Generated narration is not configured on this server' });
      return;
    }

    const outcome = await generateNarration(book, slot, voiceId, {
      id: user.id,
      isAdmin: user.role === 'admin',
    });

    switch (outcome.kind) {
      case 'ready':
        res.json(outcome.clip);
        return;
      case 'no-such-slot':
        res.status(404).json({ error: 'Nothing to narrate for that page' });
        return;
      case 'quota':
        sendQuotaDenied(res, outcome.decision);
        return;
      case 'upstream-failed':
        res.status(502).json({ error: 'Narration generation failed. Nothing was charged.' });
        return;
    }
  },
);
