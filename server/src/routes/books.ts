import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { Request, Response, NextFunction } from 'express';
import {
  BookListResponseSchema,
  BookMineResponseSchema,
  BookFacetResponseSchema,
  BookDetailResponseSchema,
  BookPublishResponseSchema,
  BookDeleteResponseSchema,
  BookUpdatePageRequestSchema,
  BookUpdatePageResponseSchema,
  BookReviseRequestSchema,
  BookReviseResponseSchema,
  BookRestoreVersionResponseSchema,
  BookVersionListResponseSchema,
  BookIllustrateRequestSchema,
  BookIllustrateResponseSchema,
  IllustrationVersionListResponseSchema,
  BookIllustrationRevertRequestSchema,
  BookIllustrationRevertResponseSchema,
  CharacterPortraitGenerateRequestSchema,
  CharacterPortraitGenerateResponseSchema,
  CharacterPortraitVersionListResponseSchema,
  type BookUpdatePageRequest,
  type BookReviseRequest,
  type BookIllustrateRequest,
  type BookIllustrationRevertRequest,
  type CharacterPortraitGenerateRequest,
  type Character,
} from '@storybook/shared';
import prisma from '../db/prisma';
import { getAuthUser } from './auth';
import {
  generateIllustration,
  generateCharacterPortrait,
  listCharacterPortraitVersions,
  listIllustrationVersions,
  collectRequiredPortraitRefs,
  isImageGenConfigured,
} from '../services/illustrations';
import { parseAiJson } from '../services/parseAiJson';
import { validate } from '../middleware/validate';

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

/**
 * Express middleware: require an authenticated user. Attaches the resolved
 * user to res.locals.user for downstream handlers. Returns 401 if there's no
 * valid token. Use this BEFORE `validate(...)` so unauthenticated callers
 * don't get request-shape feedback they're not entitled to see.
 */
async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.locals.user = user;
  next();
}

router.get(
  '/',
  validate({
    name: 'GET /api/books',
    response: BookListResponseSchema,
  }),
  async (req: Request, res: Response) => {
    const { theme, age_range, featured, search } = req.query;

    const where: Record<string, unknown> = { status: 'published', deleted_at: null };
    if (theme) where.theme = theme;
    if (age_range) where.age_range = age_range;
    if (featured === 'true') where.is_featured = true;
    if (search && typeof search === 'string' && search.trim()) {
      where.OR = [
        { title: { contains: search.trim() } },
        { description: { contains: search.trim() } },
        { author: { contains: search.trim() } },
      ];
    }

    const books = await prisma.book.findMany({
      where,
      orderBy: { is_featured: 'desc' },
    });

    res.json(books.map(hydrateBook));
  },
);

router.get(
  '/mine',
  requireAuth,
  validate({
    name: 'GET /api/books/mine',
    response: BookMineResponseSchema,
  }),
  async (_req: Request, res: Response) => {
    const user = res.locals.user as { id: string };
    const books = await prisma.book.findMany({
      where: { created_by: user.id, deleted_at: null },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });
    res.json(books.map(hydrateBook));
  },
);

router.get(
  '/themes',
  validate({
    name: 'GET /api/books/themes',
    response: BookFacetResponseSchema,
  }),
  async (_req: Request, res: Response) => {
    const books = await prisma.book.findMany({ where: { deleted_at: null }, select: { theme: true } });
    const themes = [...new Set(books.map(b => b.theme))].sort();
    res.json(themes);
  },
);

router.get(
  '/age-ranges',
  validate({
    name: 'GET /api/books/age-ranges',
    response: BookFacetResponseSchema,
  }),
  async (_req: Request, res: Response) => {
    const books = await prisma.book.findMany({ where: { deleted_at: null }, select: { age_range: true } });
    const ranges = [...new Set(books.map(b => b.age_range))].sort();
    res.json(ranges);
  },
);

router.get(
  '/:id',
  validate({
    name: 'GET /api/books/:id',
    response: BookDetailResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const book = await prisma.book.findFirst({
      where: { id: req.params.id, deleted_at: null },
      include: {
        pages: { orderBy: { page_number: 'asc' } },
      },
    });

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    if (book.status === 'draft') {
      const user = await getAuthUser(req);
      if (!user || user.id !== book.created_by) {
        return res.status(404).json({ error: 'Book not found' });
      }
    }

    res.json(hydrateBook(book));
  },
);

router.put(
  '/:id/publish',
  requireAuth,
  validate({
    name: 'PUT /api/books/:id/publish',
    response: BookPublishResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const updated = await prisma.book.update({
      where: { id: req.params.id },
      data: { status: 'published' },
    });

    res.json(hydrateBook(updated));
  },
);

router.put(
  '/:id/unpublish',
  requireAuth,
  validate({
    name: 'PUT /api/books/:id/unpublish',
    response: BookPublishResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }
    if (book.status !== 'published') {
      return res.status(403).json({ error: 'Book is not published' });
    }

    const updated = await prisma.book.update({
      where: { id: req.params.id },
      data: { status: 'draft' },
    });

    res.json(hydrateBook(updated));
  },
);

router.delete(
  '/:id',
  requireAuth,
  validate({
    name: 'DELETE /api/books/:id',
    response: BookDeleteResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Soft-delete so admins can restore later and existing carts/orders still
    // resolve their book references. Hard deletes are reserved for the test-only
    // cleanup endpoint.
    await prisma.book.update({
      where: { id: req.params.id },
      data: { deleted_at: new Date() },
    });
    res.json({ success: true });
  },
);

router.put(
  '/:id/pages/:pageNumber',
  requireAuth,
  validate({
    name: 'PUT /api/books/:id/pages/:pageNumber',
    request: BookUpdatePageRequestSchema,
    response: BookUpdatePageResponseSchema,
  }),
  async (req: Request<{ id: string; pageNumber: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const pageNumber = parseInt(req.params.pageNumber, 10);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      return res.status(400).json({ error: 'invalid page number' });
    }

    const { illustration_description } = req.body as BookUpdatePageRequest;

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }
    if (book.status !== 'draft') {
      return res.status(403).json({ error: 'Pages can only be edited on draft books' });
    }

    try {
      await prisma.page.update({
        where: { book_id_page_number: { book_id: book.id, page_number: pageNumber } },
        data: { illustration_description },
      });
    } catch {
      return res.status(404).json({ error: 'Page not found' });
    }

    const updated = await prisma.book.findUnique({
      where: { id: book.id },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });
    res.json(updated ? hydrateBook(updated) : null);
  },
);

router.post(
  '/:id/revise',
  requireAuth,
  validate({
    name: 'POST /api/books/:id/revise',
    request: BookReviseRequestSchema,
    response: BookReviseResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const { feedback, newPageCount: rawNewPageCount } = req.body as BookReviseRequest;

    const book = await prisma.book.findFirst({
      where: { id: req.params.id, deleted_at: null },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });

    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const currentPageCount = book.pages.length;
    let targetPageCount = currentPageCount;
    if (typeof rawNewPageCount === 'number' && Number.isFinite(rawNewPageCount)) {
      const clamped = Math.min(15, Math.max(3, Math.round(rawNewPageCount)));
      targetPageCount = clamped;
    }
    const pageCountChanged = targetPageCount !== currentPageCount;

    try {
      const currentPages = book.pages.map(p => ({
        page_number: p.page_number,
        text: p.text,
        illustrationDescription: p.illustration_description,
      }));

      const client = new Anthropic({ apiKey });

      const hydrated = hydrateBook(book);
      const castLine = hydrated.characters.length > 0
        ? `Cast (keep these characters consistent): ${hydrated.characters.map(c => `${c.name} (${c.role}${c.relationship ? `, ${c.relationship}` : ''})`).join('; ')}`
        : '';

      const pageCountInstruction = pageCountChanged
        ? `Restructure the story to have exactly ${targetPageCount} pages (was ${currentPageCount}). ${
            targetPageCount > currentPageCount
              ? `Add ${targetPageCount - currentPageCount} new page(s) naturally — expand the middle, slow down a transition, or add a beat. Keep the original arc intact.`
              : `Condense to ${targetPageCount} pages by merging or trimming pages — keep the most important beats and the resolution.`
          }`
        : `Keep the same number of pages (${currentPageCount}).`;

      const prompt = `You are revising a children's story based on reader feedback. Here is the current story:

Title: ${book.title}
Theme: ${book.theme}
Age range: ${book.age_range}
Description: ${book.description}
${castLine}

Current pages:
${currentPages.map(p => `Page ${p.page_number}: ${p.text}\n  Illustration: ${p.illustrationDescription}`).join('\n\n')}

Reader feedback: ${feedback}

Revise the story incorporating the feedback. ${pageCountInstruction} You may also update the description if the story changed significantly.

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "description": "Updated 1-2 sentence book description",
  "pages": [
    {
      "text": "The revised story text for this page",
      "illustrationDescription": "A detailed description of the illustration"
    }
  ]
}`;

      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: Math.max(2000, targetPageCount * 500),
        messages: [{ role: 'user', content: prompt }],
      });

      const firstBlock = message.content[0];
      if (firstBlock.type !== 'text') {
        throw new Error('Unexpected response type from AI');
      }

      const revised = parseAiJson(firstBlock.text) as {
        description: string;
        pages: { text: string; illustrationDescription: string }[];
      };

      const finalPageCount = revised.pages.length;

      // Wrap snapshot + page mutations + book.version bump in a single
      // transaction so a partial failure can't leave a BookVersion row at
      // book.version without bumping book.version forward — which would make
      // the next revise hit a (book_id, version) unique-constraint conflict.
      //
      // snapshotVersion self-heals from books that ended up in that stuck
      // state before this fix: it skips past any existing BookVersion rows
      // for this book rather than colliding with them.
      const updated = await prisma.$transaction(async (tx) => {
        const maxExisting = await tx.bookVersion.aggregate({
          where: { book_id: book.id },
          _max: { version: true },
        });
        const snapshotVersion = Math.max(book.version, (maxExisting._max.version ?? 0) + 1);
        const newVersion = snapshotVersion + 1;

        await tx.bookVersion.create({
          data: {
            book_id: book.id,
            version: snapshotVersion,
            pages_json: JSON.stringify(currentPages),
            description: book.description,
            characters_json: book.characters_json,
          },
        });

        // Update pages that exist in both old and new. If either the text or the
        // illustration description changed for a page, also clear illustration_url:
        // the old image no longer matches the revised content, so showing it would
        // be a text/image mismatch (same reasoning as the version restore handler).
        const overlap = Math.min(finalPageCount, currentPageCount);
        for (let i = 0; i < overlap; i++) {
          const oldPage = book.pages[i];
          const newText = revised.pages[i].text;
          const newDescription = revised.pages[i].illustrationDescription;
          const contentChanged =
            newText !== oldPage.text || newDescription !== oldPage.illustration_description;
          await tx.page.update({
            where: { book_id_page_number: { book_id: book.id, page_number: i + 1 } },
            data: {
              text: newText,
              illustration_description: newDescription,
              ...(contentChanged ? { illustration_url: null } : {}),
            },
          });
        }
        // Add new pages if the story grew
        if (finalPageCount > currentPageCount) {
          for (let i = currentPageCount; i < finalPageCount; i++) {
            await tx.page.create({
              data: {
                book_id: book.id,
                page_number: i + 1,
                text: revised.pages[i].text,
                illustration_description: revised.pages[i].illustrationDescription,
              },
            });
          }
        }
        // Remove pages if the story shrank
        if (finalPageCount < currentPageCount) {
          await tx.page.deleteMany({
            where: { book_id: book.id, page_number: { gt: finalPageCount } },
          });
        }

        return tx.book.update({
          where: { id: book.id },
          data: { version: newVersion, description: revised.description },
          include: { pages: { orderBy: { page_number: 'asc' } } },
        });
      });

      res.json(hydrateBook(updated));
    } catch (err: unknown) {
      console.error('Revision error:', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to revise story. ' + message });
    }
  },
);

router.put(
  '/:id/versions/:version/restore',
  requireAuth,
  validate({
    name: 'PUT /api/books/:id/versions/:version/restore',
    response: BookRestoreVersionResponseSchema,
  }),
  async (req: Request<{ id: string; version: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const targetVersion = parseInt(req.params.version, 10);
    if (!Number.isFinite(targetVersion) || targetVersion < 1) {
      return res.status(400).json({ error: 'invalid version' });
    }

    const book = await prisma.book.findFirst({
      where: { id: req.params.id, deleted_at: null },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });

    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }
    if (book.status !== 'draft') {
      return res.status(403).json({ error: 'Books can only be restored while in draft' });
    }

    const snapshot = await prisma.bookVersion.findUnique({
      where: { book_id_version: { book_id: book.id, version: targetVersion } },
    });
    if (!snapshot) {
      return res.status(404).json({ error: 'Version not found' });
    }

    try {
      // Snapshot current state before mutating, so restore is itself reversible.
      const currentPages = book.pages.map(p => ({
        page_number: p.page_number,
        text: p.text,
        illustrationDescription: p.illustration_description,
      }));
      // Normalize the same way GET /:id/versions does (line ~614): legacy
      // BookVersion rows were written without page_number on each page, so
      // synthesize 1-based positions for them. Without this, restoring a
      // legacy snapshot would call tx.page.create with page_number: undefined.
      const restoredPages = (
        JSON.parse(snapshot.pages_json) as {
          page_number?: number;
          text: string;
          illustrationDescription: string;
        }[]
      ).map((p, i) => ({ ...p, page_number: p.page_number ?? i + 1 }));

      // Same transactional + self-healing pattern as the revise flow: a
      // partial failure here used to leave a BookVersion row at book.version
      // without bumping book.version, breaking subsequent restores/revises
      // with a unique-constraint error.
      const updated = await prisma.$transaction(async (tx) => {
        const maxExisting = await tx.bookVersion.aggregate({
          where: { book_id: book.id },
          _max: { version: true },
        });
        const snapshotVersion = Math.max(book.version, (maxExisting._max.version ?? 0) + 1);
        const newVersion = snapshotVersion + 1;

        await tx.bookVersion.create({
          data: {
            book_id: book.id,
            version: snapshotVersion,
            pages_json: JSON.stringify(currentPages),
            description: book.description,
            characters_json: book.characters_json,
          },
        });

        // Replace pages with the snapshot. illustration_url is intentionally
        // reset to null on every restored page: the old image URLs no longer
        // correspond to the restored text/description, so showing them would
        // be misleading. The user can re-illustrate as needed.
        await tx.page.deleteMany({ where: { book_id: book.id } });
        for (const p of restoredPages) {
          await tx.page.create({
            data: {
              book_id: book.id,
              page_number: p.page_number,
              text: p.text,
              illustration_description: p.illustrationDescription,
              illustration_url: null,
            },
          });
        }

        return tx.book.update({
          where: { id: book.id },
          data: {
            version: newVersion,
            // Only restore description/characters when the snapshot has them —
            // versions created before the snapshot was expanded will be null.
            ...(snapshot.description !== null ? { description: snapshot.description } : {}),
            ...(snapshot.characters_json !== null ? { characters_json: snapshot.characters_json } : {}),
          },
          include: { pages: { orderBy: { page_number: 'asc' } } },
        });
      });

      res.json(hydrateBook(updated));
    } catch (err: unknown) {
      console.error('Restore error:', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to restore version. ' + message });
    }
  },
);

router.get(
  '/:id/versions',
  requireAuth,
  validate({
    name: 'GET /api/books/:id/versions',
    response: BookVersionListResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const versions = await prisma.bookVersion.findMany({
      where: { book_id: req.params.id },
      orderBy: { version: 'desc' },
    });

    // Synthesize page_number from array index for legacy snapshots — early
    // BookVersion rows (written before generate.ts persisted page_number)
    // contain only { text, illustrationDescription }. Page number is
    // deterministically array-index + 1, so the data isn't lost, just
    // implicit. `?? i + 1` lets newer snapshots that include an explicit
    // page_number keep their value.
    res.json(versions.map(v => {
      const pages = JSON.parse(v.pages_json) as Array<{
        text: string;
        illustrationDescription: string;
        page_number?: number;
      }>;
      return {
        ...v,
        pages: pages.map((p, i) => ({ ...p, page_number: p.page_number ?? i + 1 })),
      };
    }));
  },
);

router.post(
  '/:id/illustrate',
  requireAuth,
  validate({
    name: 'POST /api/books/:id/illustrate',
    request: BookIllustrateRequestSchema,
    response: BookIllustrateResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    if (!isImageGenConfigured()) {
      return res.status(501).json({ error: 'Image generation not configured' });
    }

    const book = await prisma.book.findFirst({
      where: { id: req.params.id, deleted_at: null },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });

    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const { pageNumber, feedback } = req.body as BookIllustrateRequest;

    const pagesToIllustrate = pageNumber
      ? book.pages.filter(p => p.page_number === pageNumber)
      : book.pages.filter(p => !p.illustration_url);

    if (pagesToIllustrate.length === 0) {
      return res.status(400).json({ error: 'No pages to illustrate' });
    }

    const hydratedBook = hydrateBook(book);

    // IV2 Phase 2: collect the required cast's portrait references (primary +
    // antagonist with a portrait_url) and pass them to every page so characters
    // stay consistent. Phase 2 has no per-page character mapping — the same refs
    // ride every page. When no required character has a portrait yet, refs is
    // empty and we pass `undefined`, which keeps generateIllustration on the
    // byte-identical prompt-only path (no 403, no regression vs. IV1/today).
    const portraitRefs = collectRequiredPortraitRefs(hydratedBook.characters);
    const referenceImages = portraitRefs.length > 0 ? portraitRefs : undefined;

    try {
      for (const page of pagesToIllustrate) {
        const url = await generateIllustration(
          book.id,
          page.page_number,
          page.illustration_description,
          pageNumber ? feedback : undefined,
          book.style_descriptor,
          hydratedBook.characters,
          referenceImages,
        );

        if (url) {
          await prisma.page.update({
            where: { id: page.id },
            data: { illustration_url: url },
          });
        }
      }

      const updated = await prisma.book.findUnique({
        where: { id: book.id },
        include: { pages: { orderBy: { page_number: 'asc' } } },
      });

      res.json(updated ? hydrateBook(updated) : null);
    } catch (err: unknown) {
      console.error('Illustration error:', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to generate illustrations. ' + message });
    }
  },
);

// Generate (or regenerate) one character's canonical portrait (IV2 Phase 2).
// Mirrors /illustrate: requireAuth -> validate -> handler, owner-gated, 501 when
// image gen is unconfigured. The character is addressed by :characterIndex (its
// position in the hydrated `characters` array) rather than :role, because names
// and roles aren't guaranteed unique (spec ADR sub-decision). On success the
// handler patches characters_json[index].portrait_url to the new URL and returns
// the full hydrated book so the client re-renders the cast.
router.post(
  '/:id/characters/:characterIndex/portrait',
  requireAuth,
  validate({
    name: 'POST /api/books/:id/characters/:characterIndex/portrait',
    request: CharacterPortraitGenerateRequestSchema,
    response: CharacterPortraitGenerateResponseSchema,
  }),
  async (req: Request<{ id: string; characterIndex: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    if (!isImageGenConfigured()) {
      return res.status(501).json({ error: 'Image generation not configured' });
    }

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const characterIndex = parseInt(req.params.characterIndex, 10);
    if (!Number.isInteger(characterIndex) || characterIndex < 0) {
      return res.status(400).json({ error: 'invalid character index' });
    }

    const hydrated = hydrateBook(book);
    const character = hydrated.characters[characterIndex];
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const { feedback } = req.body as CharacterPortraitGenerateRequest;

    try {
      const url = await generateCharacterPortrait(
        book.id,
        characterIndex,
        character.name,
        character.descriptor,
        feedback,
        book.style_descriptor,
      );

      if (url) {
        // Patch only this character's portrait_url; leave every other character
        // and every other book field untouched. Re-read the cast from the same
        // JSON we hydrated so we round-trip the blob faithfully.
        const characters = [...hydrated.characters];
        characters[characterIndex] = { ...characters[characterIndex], portrait_url: url };
        await prisma.book.update({
          where: { id: book.id },
          data: { characters_json: JSON.stringify(characters) },
        });
      }

      const updated = await prisma.book.findUnique({
        where: { id: book.id },
        include: { pages: { orderBy: { page_number: 'asc' } } },
      });

      res.json(updated ? hydrateBook(updated) : null);
    } catch (err: unknown) {
      console.error('Portrait generation error:', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to generate portrait. ' + message });
    }
  },
);

// List one character's portrait version history. Owner-gated; reads the
// IllustrationVersion rows stored under that character's reserved portrait slot.
router.get(
  '/:id/characters/:characterIndex/portraits',
  requireAuth,
  validate({
    name: 'GET /api/books/:id/characters/:characterIndex/portraits',
    response: CharacterPortraitVersionListResponseSchema,
  }),
  async (req: Request<{ id: string; characterIndex: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const characterIndex = parseInt(req.params.characterIndex, 10);
    if (!Number.isInteger(characterIndex) || characterIndex < 0) {
      return res.status(400).json({ error: 'invalid character index' });
    }

    const versions = await listCharacterPortraitVersions(book.id, characterIndex);
    res.json(versions);
  },
);

router.get(
  '/:id/illustrations/:pageNumber',
  requireAuth,
  validate({
    name: 'GET /api/books/:id/illustrations/:pageNumber',
    response: IllustrationVersionListResponseSchema,
  }),
  async (req: Request<{ id: string; pageNumber: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const versions = await listIllustrationVersions(book.id, parseInt(req.params.pageNumber));
    res.json(versions);
  },
);

router.put(
  '/:id/illustrations/:pageNumber/revert',
  requireAuth,
  validate({
    name: 'PUT /api/books/:id/illustrations/:pageNumber/revert',
    request: BookIllustrationRevertRequestSchema,
    response: BookIllustrationRevertResponseSchema,
  }),
  async (req: Request<{ id: string; pageNumber: string }>, res: Response) => {
    const user = res.locals.user as { id: string };

    const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null } });
    if (!book || book.created_by !== user.id) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const { url } = req.body as BookIllustrationRevertRequest;

    const pageNum = parseInt(req.params.pageNumber);
    await prisma.page.update({
      where: { book_id_page_number: { book_id: book.id, page_number: pageNum } },
      data: { illustration_url: url },
    });

    const updated = await prisma.book.findUnique({
      where: { id: book.id },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });

    res.json(updated ? hydrateBook(updated) : null);
  },
);

export default router;
