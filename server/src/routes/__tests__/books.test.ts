import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdir, writeFile, rm, rmdir } from 'fs/promises';
import { join } from 'path';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { PUBLISHED_IMMUTABLE_ERROR } from '../../lib/availability';
import { COST_CENTS, costCentsFor } from '../../services/spend';

// Stub the Anthropic SDK at module boundary so /revise tests can drive the
// handler past the API key check without making real network calls.
// The mocked client returns a canned JSON-shaped response that the revise
// handler parses as a 5-page story.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  }
  return { default: MockAnthropic };
});

// Stub the illustrations service so /illustrate tests don't hit OpenAI or
// touch the real filesystem. Tests configure return value / throws per case.
// We keep `listIllustrationVersions` as a passthrough to the real impl by
// re-importing it inside the factory — the GET /illustrations/:pageNumber
// suite uses real DB rows and shouldn't be affected.
const mockGenerateIllustration = vi.fn();
const mockGenerateCharacterPortrait = vi.fn();
const mockListCharacterPortraitVersions = vi.fn();
vi.mock('../../services/illustrations', async () => {
  const actual = await vi.importActual<typeof import('../../services/illustrations')>(
    '../../services/illustrations',
  );
  return {
    ...actual,
    generateIllustration: (...args: unknown[]) => mockGenerateIllustration(...args),
    generateCharacterPortrait: (...args: unknown[]) => mockGenerateCharacterPortrait(...args),
    listCharacterPortraitVersions: (...args: unknown[]) =>
      mockListCharacterPortraitVersions(...args),
  };
});

function mockClaudeReviseResponse(pages: { text: string; illustrationDescription: string }[], description = 'Revised description') {
  mockCreate.mockResolvedValueOnce({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ description, pages }),
      },
    ],
  });
}

async function createUserAndGetToken(app: Express) {
  await allowEmail('author@example.com');
  const res = await request(app).post('/api/auth/register').send({
    email: 'author@example.com',
    name: 'Author',
    password: 'pass1234',
  });
  return res.body.token as string;
}

describe('Books API routes', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  describe('GET /api/books', () => {
    it('returns all 6 seeded books', async () => {
      const res = await request(app).get('/api/books');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(6);
    });

    it('excludes draft books from storefront listing', async () => {
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft' },
      });

      const res = await request(app).get('/api/books');
      expect(res.body).toHaveLength(5);
      expect(res.body.find((b: { id: string }) => b.id === 'luna-star-garden')).toBeUndefined();
    });

    it('each book has required fields', async () => {
      const res = await request(app).get('/api/books');
      for (const book of res.body) {
        expect(book).toHaveProperty('id');
        expect(book).toHaveProperty('title');
        expect(book).toHaveProperty('author');
        expect(book).toHaveProperty('description');
        expect(book).toHaveProperty('theme');
        expect(book).toHaveProperty('price');
        expect(book).toHaveProperty('status');
      }
    });

    it('sorts featured books first', async () => {
      const res = await request(app).get('/api/books');
      const featured = res.body.filter((b: { is_featured: boolean }) => b.is_featured);
      const nonFeatured = res.body.filter((b: { is_featured: boolean }) => !b.is_featured);
      const lastFeaturedIdx = res.body.indexOf(featured[featured.length - 1]);
      const firstNonFeaturedIdx = res.body.indexOf(nonFeatured[0]);
      expect(lastFeaturedIdx).toBeLessThan(firstNonFeaturedIdx);
    });
  });

  describe('GET /api/books?theme=fantasy', () => {
    it('filters books by theme', async () => {
      const res = await request(app).get('/api/books?theme=fantasy');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const book of res.body) {
        expect(book.theme).toBe('fantasy');
      }
    });

    it('returns empty array for unknown theme', async () => {
      const res = await request(app).get('/api/books?theme=nonexistent');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });

  describe('GET /api/books/themes', () => {
    it('returns unique themes sorted alphabetically', async () => {
      const res = await request(app).get('/api/books/themes');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(6);
      const sorted = [...res.body].sort();
      expect(res.body).toEqual(sorted);
    });
  });

  describe('GET /api/books/:id', () => {
    it('returns a book with its pages', async () => {
      const res = await request(app).get('/api/books/luna-star-garden');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('luna-star-garden');
      expect(res.body.title).toBe('Luna and the Star Garden');
      expect(res.body.pages).toHaveLength(5);
    });

    it('pages are sorted by page_number', async () => {
      const res = await request(app).get('/api/books/luna-star-garden');
      const pageNumbers = res.body.pages.map((p: { page_number: number }) => p.page_number);
      expect(pageNumbers).toEqual([1, 2, 3, 4, 5]);
    });

    it('returns 404 for nonexistent book', async () => {
      const res = await request(app).get('/api/books/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Book not found');
    });

    it('hides draft books from unauthenticated users', async () => {
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft' },
      });

      const res = await request(app).get('/api/books/luna-star-garden');
      expect(res.status).toBe(404);
    });

    it('shows draft book to its creator', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id },
      });

      const res = await request(app)
        .get('/api/books/luna-star-garden')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('luna-star-garden');
    });
  });

  describe('PUT /api/books/:id/publish', () => {
    it('publishes a draft book', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/publish')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('published');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).put('/api/books/luna-star-garden/publish');
      expect(res.status).toBe(401);
    });

    it('returns 404 for another user\'s book', async () => {
      const token = await createUserAndGetToken(app);

      const res = await request(app)
        .put('/api/books/luna-star-garden/publish')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/books/:id/unpublish', () => {
    it('unpublishes a published book owned by the user', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'published', created_by: user!.id },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/unpublish')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('draft');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).put('/api/books/luna-star-garden/unpublish');
      expect(res.status).toBe(401);
    });

    it('returns 404 for another user\'s book', async () => {
      const token = await createUserAndGetToken(app);

      const res = await request(app)
        .put('/api/books/luna-star-garden/unpublish')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns 403 if the book is not currently published', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/unpublish')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/books/:id/versions/:version/restore', () => {
    async function setupDraftWithSnapshot(token: string) {
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: {
          status: 'draft',
          created_by: user!.id,
          version: 2,
          description: 'Current description',
          characters_json: JSON.stringify([{ role: 'primary', name: 'Luna' }]),
        },
      });

      // Give the current draft pages an illustration_url so we can assert
      // the restore wipes them.
      await prisma.page.updateMany({
        where: { book_id: 'luna-star-garden' },
        data: { illustration_url: 'https://example.com/current.png' },
      });

      // Insert a v1 snapshot with different content + page count.
      const snapshotPages = [
        { page_number: 1, text: 'Old page 1', illustrationDescription: 'Old illust 1' },
        { page_number: 2, text: 'Old page 2', illustrationDescription: 'Old illust 2' },
        { page_number: 3, text: 'Old page 3', illustrationDescription: 'Old illust 3' },
      ];
      await prisma.bookVersion.create({
        data: {
          book_id: 'luna-star-garden',
          version: 1,
          pages_json: JSON.stringify(snapshotPages),
          description: 'Original description',
          characters_json: JSON.stringify([{ role: 'primary', name: 'OldLuna' }]),
        },
      });

      return { user: user!, token, snapshotPages };
    }

    it('returns 401 without auth', async () => {
      const res = await request(app).put('/api/books/luna-star-garden/versions/1/restore');
      expect(res.status).toBe(401);
    });

    it('returns 404 if book does not exist', async () => {
      const token = await createUserAndGetToken(app);
      const res = await request(app)
        .put('/api/books/nope/versions/1/restore')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for another user\'s book', async () => {
      const ownerToken = await createUserAndGetToken(app);
      await setupDraftWithSnapshot(ownerToken);

      // Register a second user and try to restore using their token.
      await allowEmail('intruder@example.com');
      const otherRes = await request(app).post('/api/auth/register').send({
        email: 'intruder@example.com',
        name: 'Intruder',
        password: 'pass1234',
      });
      const otherToken = otherRes.body.token as string;

      const res = await request(app)
        .put('/api/books/luna-star-garden/versions/1/restore')
        .set('Authorization', `Bearer ${otherToken}`);
      expect(res.status).toBe(404);
    });

    it('returns 403 if book is not in draft status', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'published', created_by: user!.id, version: 2 },
      });
      await prisma.bookVersion.create({
        data: {
          book_id: 'luna-star-garden',
          version: 1,
          pages_json: JSON.stringify([]),
        },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/versions/1/restore')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      // #20: this route now shares one message with every other immutability 403.
      expect(res.body.error).toBe(PUBLISHED_IMMUTABLE_ERROR);
    });

    it('returns 404 if the version row does not exist', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id, version: 2 },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/versions/99/restore')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('restores pages and description, bumps version, snapshots prior state', async () => {
      const token = await createUserAndGetToken(app);
      const { snapshotPages } = await setupDraftWithSnapshot(token);

      const res = await request(app)
        .put('/api/books/luna-star-garden/versions/1/restore')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      expect(res.body.description).toBe('Original description');
      expect(res.body.version).toBe(3);
      expect(res.body.characters).toEqual([{ role: 'primary', name: 'OldLuna' }]);
      expect(res.body.pages).toHaveLength(snapshotPages.length);
      expect(res.body.pages.map((p: { text: string }) => p.text)).toEqual(
        snapshotPages.map(p => p.text),
      );

      // A fresh BookVersion snapshotting the pre-restore state should exist.
      const versions = await prisma.bookVersion.findMany({
        where: { book_id: 'luna-star-garden' },
        orderBy: { version: 'asc' },
      });
      expect(versions).toHaveLength(2);
      const preRestoreSnapshot = versions.find(v => v.version === 2);
      expect(preRestoreSnapshot).toBeDefined();
      expect(preRestoreSnapshot!.description).toBe('Current description');
      const preRestorePages = JSON.parse(preRestoreSnapshot!.pages_json) as {
        text: string;
      }[];
      expect(preRestorePages).toHaveLength(5);
      expect(preRestorePages[0].text).toBe('Page 1 text');
    });

    it('clears illustration_url on every restored page', async () => {
      const token = await createUserAndGetToken(app);
      await setupDraftWithSnapshot(token);

      const res = await request(app)
        .put('/api/books/luna-star-garden/versions/1/restore')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      for (const page of res.body.pages) {
        expect(page.illustration_url).toBeNull();
      }
    });

    it('restores a legacy snapshot whose pages_json has no page_number keys', async () => {
      // BookVersion rows written before page_number was added to the snapshot
      // shape store pages as { text, illustrationDescription } only. The
      // GET /:id/versions listing synthesizes page_number: i + 1; restore must
      // do the same or it would call page.create with page_number: undefined
      // and crash.
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id, version: 2 },
      });
      await prisma.bookVersion.create({
        data: {
          book_id: 'luna-star-garden',
          version: 1,
          // Note: NO page_number on the page objects — legacy shape.
          pages_json: JSON.stringify([
            { text: 'Legacy page 1', illustrationDescription: 'Legacy illust 1' },
            { text: 'Legacy page 2', illustrationDescription: 'Legacy illust 2' },
            { text: 'Legacy page 3', illustrationDescription: 'Legacy illust 3' },
          ]),
        },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/versions/1/restore')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.pages).toHaveLength(3);
      expect(res.body.pages.map((p: { page_number: number }) => p.page_number)).toEqual([1, 2, 3]);
      expect(res.body.pages[0].text).toBe('Legacy page 1');
    });
  });

  describe('GET /api/books/:id/versions', () => {
    async function claimBookForUser(bookId: string, email: string) {
      const user = await prisma.user.findFirst({ where: { email } });
      await prisma.book.update({
        where: { id: bookId },
        data: { created_by: user!.id, status: 'draft' },
      });
      return user!;
    }

    it('synthesizes page_number for legacy snapshots that lack it', async () => {
      // Regression: BookVersion rows written by /api/generate before the
      // page_number fix only contain { text, illustrationDescription }.
      // The response schema requires page_number, so the GET handler must
      // synth it from array index. Without this, the validate middleware
      // returns a 500 on every GET versions call for legacy books.
      const token = await createUserAndGetToken(app);
      await claimBookForUser('luna-star-garden', 'author@example.com');

      const legacyPages = [
        { text: 'p1', illustrationDescription: 'i1' },
        { text: 'p2', illustrationDescription: 'i2' },
        { text: 'p3', illustrationDescription: 'i3' },
      ];
      await prisma.bookVersion.create({
        data: {
          book_id: 'luna-star-garden',
          version: 1,
          pages_json: JSON.stringify(legacyPages),
        },
      });

      const res = await request(app)
        .get('/api/books/luna-star-garden/versions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].pages).toHaveLength(3);
      expect(res.body[0].pages.map((p: { page_number: number }) => p.page_number)).toEqual([1, 2, 3]);
      expect(res.body[0].pages[0].text).toBe('p1');
      expect(res.body[0].pages[2].illustrationDescription).toBe('i3');
    });

    it('preserves explicit page_number on newer snapshots', async () => {
      // The synth uses `?? i + 1` so snapshots that did persist page_number
      // (e.g. from the /restore or /revise paths) keep their value even if
      // it doesn't equal index + 1.
      const token = await createUserAndGetToken(app);
      await claimBookForUser('luna-star-garden', 'author@example.com');

      const explicitPages = [
        { page_number: 10, text: 'p10', illustrationDescription: 'i10' },
        { page_number: 20, text: 'p20', illustrationDescription: 'i20' },
      ];
      await prisma.bookVersion.create({
        data: {
          book_id: 'luna-star-garden',
          version: 1,
          pages_json: JSON.stringify(explicitPages),
        },
      });

      const res = await request(app)
        .get('/api/books/luna-star-garden/versions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body[0].pages.map((p: { page_number: number }) => p.page_number)).toEqual([10, 20]);
    });
  });

  describe('POST /api/books/:id/revise', () => {
    beforeEach(() => {
      mockCreate.mockReset();
      process.env.ANTHROPIC_API_KEY = 'sk-test';
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/books/luna-star-garden/revise')
        .send({ feedback: 'make it more fun' });
      expect(res.status).toBe(401);
    });

    it('returns 404 if the book belongs to another user', async () => {
      const token = await createUserAndGetToken(app);

      const res = await request(app)
        .post('/api/books/luna-star-garden/revise')
        .set('Authorization', `Bearer ${token}`)
        .send({ feedback: 'make it more fun' });
      expect(res.status).toBe(404);
    });

    it('returns 400 if feedback is missing or empty', async () => {
      const token = await createUserAndGetToken(app);

      const missing = await request(app)
        .post('/api/books/luna-star-garden/revise')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(missing.status).toBe(400);

      const empty = await request(app)
        .post('/api/books/luna-star-garden/revise')
        .set('Authorization', `Bearer ${token}`)
        .send({ feedback: '   ' });
      expect(empty.status).toBe(400);
    });

    it('clears illustration_url on a page whose text changes', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id },
      });
      // Give page 1 an illustration_url that should be wiped by the revision.
      await prisma.page.update({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
        data: { illustration_url: 'https://example.com/old.png' },
      });

      // Claude returns a 5-page response where page 1 text changes,
      // pages 2-5 keep their original text + illustration_description.
      mockClaudeReviseResponse([
        { text: 'NEW page 1 text', illustrationDescription: 'NEW illust 1' },
        { text: 'Page 2 text', illustrationDescription: 'Illustration 2' },
        { text: 'Page 3 text', illustrationDescription: 'Illustration 3' },
        { text: 'Page 4 text', illustrationDescription: 'Illustration 4' },
        { text: 'Page 5 text', illustrationDescription: 'Illustration 5' },
      ]);

      const res = await request(app)
        .post('/api/books/luna-star-garden/revise')
        .set('Authorization', `Bearer ${token}`)
        .send({ feedback: 'rewrite page 1' });
      expect(res.status).toBe(200);

      const page1 = res.body.pages.find((p: { page_number: number }) => p.page_number === 1);
      expect(page1).toBeDefined();
      expect(page1.text).toBe('NEW page 1 text');
      expect(page1.illustration_url).toBeNull();
    });

    it('self-heals when a stale BookVersion row already exists at book.version', async () => {
      // Reproduces the bug from the live site: a prior revise attempt created
      // a BookVersion row at book.version but failed before bumping the book's
      // version forward (no transaction). Retrying would hit a
      // (book_id, version) unique-constraint error. The fix wraps the writes
      // in a transaction AND computes snapshotVersion past any existing rows.
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id, version: 3 },
      });

      // Simulate the stuck state: a BookVersion already exists at v=3, exactly
      // matching book.version. Without the fix, the next revise would crash.
      await prisma.bookVersion.create({
        data: {
          book_id: 'luna-star-garden',
          version: 3,
          pages_json: '[]',
          description: 'leftover snapshot from a partial revise',
        },
      });

      mockClaudeReviseResponse([
        { text: 'Page 1 text', illustrationDescription: 'Illustration 1' },
        { text: 'Page 2 text', illustrationDescription: 'Illustration 2' },
        { text: 'Page 3 text', illustrationDescription: 'Illustration 3' },
        { text: 'Page 4 text', illustrationDescription: 'Illustration 4' },
        { text: 'Page 5 text', illustrationDescription: 'Illustration 5' },
      ]);

      const res = await request(app)
        .post('/api/books/luna-star-garden/revise')
        .set('Authorization', `Bearer ${token}`)
        .send({ feedback: 'retry after the stuck failure' });
      expect(res.status).toBe(200);

      // Snapshot skipped past the stale v=3 row → new snapshot at v=4,
      // book.version bumped to v=5. Both old and new BookVersion rows coexist.
      const snapshots = await prisma.bookVersion.findMany({
        where: { book_id: 'luna-star-garden' },
        orderBy: { version: 'asc' },
      });
      expect(snapshots.map((s) => s.version)).toEqual([3, 4]);

      const after = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(after?.version).toBe(5);
    });

    // Same trap as POST /api/generate: a `.env` copied from `.env.example`
    // leaves ANTHROPIC_API_KEY=your-api-key-here, which a bare `!apiKey` guard
    // read as configured. The request then reached Anthropic, 401'd, and the
    // author got an opaque 500 on a revision instead of "not configured".
    describe('ANTHROPIC_API_KEY config gate', () => {
      async function setupOwnedDraft(): Promise<string> {
        const token = await createUserAndGetToken(app);
        const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
        await prisma.book.update({
          where: { id: 'luna-star-garden' },
          data: { status: 'draft', created_by: user!.id },
        });
        return token;
      }

      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it('500s with the not-configured envelope when the key is unset (the oracle)', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', undefined);
        const token = await setupOwnedDraft();

        const res = await request(app)
          .post('/api/books/luna-star-garden/revise')
          .set('Authorization', `Bearer ${token}`)
          .send({ feedback: 'make it more fun' });

        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ error: 'ANTHROPIC_API_KEY not configured' });
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it.each([
        ['your-api-key-here', 'the .env.example literal'],
        ['<your-anthropic-key>', 'still in angle brackets'],
      ])('treats a placeholder key (%s — %s) exactly like an unset one', async (key) => {
        vi.stubEnv('ANTHROPIC_API_KEY', key);
        const token = await setupOwnedDraft();

        const res = await request(app)
          .post('/api/books/luna-star-garden/revise')
          .set('Authorization', `Bearer ${token}`)
          .send({ feedback: 'make it more fun' });

        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ error: 'ANTHROPIC_API_KEY not configured' });
        // The gate sits before the paid call and before recordUsage, so a
        // misconfigured server bills nobody.
        expect(mockCreate).not.toHaveBeenCalled();
        expect(await prisma.usageLog.count()).toBe(0);
      });

      it('lets a real key that merely contains a filler word through to Claude', async () => {
        // The false-positive guard. A predicate that rejected this would lock
        // an author out of a working key, which is worse than the bug fixed.
        vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-placeholder-9f8e7d6c');
        const token = await setupOwnedDraft();
        mockClaudeReviseResponse([
          { text: 'Page 1 text', illustrationDescription: 'Illustration 1' },
          { text: 'Page 2 text', illustrationDescription: 'Illustration 2' },
          { text: 'Page 3 text', illustrationDescription: 'Illustration 3' },
          { text: 'Page 4 text', illustrationDescription: 'Illustration 4' },
          { text: 'Page 5 text', illustrationDescription: 'Illustration 5' },
        ]);

        const res = await request(app)
          .post('/api/books/luna-star-garden/revise')
          .set('Authorization', `Bearer ${token}`)
          .send({ feedback: 'make it more fun' });

        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalled();
      });
    });
  });

  describe('POST /api/books/:id/illustrate', () => {
    // Every env var the pin + provider selection reads. Snapshotted as a set so
    // a test that flips one (the 409 case needs FAL_KEY present and
    // OPENAI_API_KEY absent) can't leak into the next, and so a developer
    // machine that happens to export FAL_KEY or *_IMAGE_MODEL gets the same
    // result as CI.
    const IMAGE_ENV_VARS = [
      'IMAGE_PROVIDER',
      'OPENAI_API_KEY',
      'FAL_KEY',
      'OPENAI_IMAGE_MODEL',
      'FAL_IMAGE_MODEL',
    ] as const;
    let originalImageEnv: Record<string, string | undefined>;

    beforeEach(() => {
      mockGenerateIllustration.mockReset();
      originalImageEnv = Object.fromEntries(
        IMAGE_ENV_VARS.map((k) => [k, process.env[k]]),
      );
      for (const k of IMAGE_ENV_VARS) delete process.env[k];
      // Pin the provider to openai so isImageGenConfigured() gates on
      // OPENAI_API_KEY — this suite exercises the OpenAI path. (The service
      // default is now 'fal', which would otherwise gate on FAL_KEY.)
      process.env.IMAGE_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
    });

    afterEach(async () => {
      for (const k of IMAGE_ENV_VARS) {
        const original = originalImageEnv[k];
        if (original === undefined) delete process.env[k];
        else process.env[k] = original;
      }
      vi.unstubAllEnvs();
      // Remove only the anchor fixtures this suite wrote — never the whole
      // book directory, which on a dev machine holds real generated art.
      for (const file of anchorFixtures) await rm(file, { force: true });
      anchorFixtures.length = 0;
      try {
        await rmdir(ANCHOR_DIR);
      } catch {
        // Non-empty (real art lives here) or never created — either is fine.
      }
    });

    // ---------------------------------------------------------------------
    // Style-anchor fixtures (spec: reroll-style-consistency, mitigation B).
    // resolveStyleAnchor is a passthrough to the real implementation and stats
    // the real disk on purpose, so a page that is supposed to anchor needs
    // actual bytes behind its illustration_url. A page whose URL has no file
    // must NOT anchor — that is the restored-from-another-machine case.
    // ---------------------------------------------------------------------
    const ANCHOR_DIR = join(
      import.meta.dirname, '../../../public/illustrations', 'luna-star-garden',
    );
    // 1x1 transparent PNG — the bytes are never read by these tests, only stat'd.
    const FAKE_PNG_B64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const anchorFixtures: string[] = [];

    /**
     * Give a page an illustration_url with real bytes behind it, and pin the
     * book to the provider this suite has a key for. The pin is not incidental:
     * a book with art is pinned after mitigation A, and without it the fixture
     * file's mtime (today, i.e. post-cutover) would infer `fal`, which this
     * suite deliberately has no FAL_KEY for — every anchor test would 409.
     * Returns the URL.
     */
    async function illustratePageOnDisk(pageNumber: number): Promise<string> {
      const filename = `page-${pageNumber}.png`;
      await mkdir(ANCHOR_DIR, { recursive: true });
      const absPath = join(ANCHOR_DIR, filename);
      await writeFile(absPath, Buffer.from(FAKE_PNG_B64, 'base64'));
      anchorFixtures.push(absPath);
      const url = `/illustrations/luna-star-garden/${filename}`;
      await prisma.page.updateMany({
        where: { book_id: 'luna-star-garden', page_number: pageNumber },
        data: { illustration_url: url },
      });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { image_provider: 'openai', image_model: 'gpt-image-1' },
      });
      return url;
    }

    // Helper: claim luna-star-garden as the authed user's draft book so the
    // route's ownership check passes. Returns the token.
    async function setupOwnedDraft(): Promise<string> {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id },
      });
      return token;
    }

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .send({});
      expect(res.status).toBe(401);
    });

    it('returns 501 when image generation is not configured', async () => {
      // Provider is pinned to openai by the suite beforeEach, so clearing the
      // OpenAI key makes isImageGenConfigured() return false.
      delete process.env.OPENAI_API_KEY;
      const token = await setupOwnedDraft();

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(501);
      expect(res.body.error).toMatch(/Image generation not configured/);
    });

    it("returns 404 when the book doesn't exist", async () => {
      const token = await createUserAndGetToken(app);

      const res = await request(app)
        .post('/api/books/does-not-exist/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it("returns 404 when the book belongs to a different user", async () => {
      const token = await createUserAndGetToken(app);
      // Book is owned by no one (seed default) — handler treats this as "not
      // owned by the caller" and 404s, same as another-user's-book.
      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it('returns 400 when all pages are already illustrated and no pageNumber is set', async () => {
      const token = await setupOwnedDraft();
      // Mark every page as already illustrated so the route's
      // "pages to illustrate" filter returns empty.
      await prisma.page.updateMany({
        where: { book_id: 'luna-star-garden' },
        data: { illustration_url: '/illustrations/luna-star-garden/page-x.png' },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No pages to illustrate/);
    });

    it('illustrates a single page on the happy path and persists the URL', async () => {
      const token = await setupOwnedDraft();

      const fakeUrl = '/illustrations/luna-star-garden/page-2.png';
      mockGenerateIllustration.mockResolvedValueOnce(fakeUrl);

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 2 });

      expect(res.status).toBe(200);
      // Response matches BookWithPagesSchema — spot-check that the structure
      // arrived (full schema validation runs in the response middleware).
      expect(res.body).toHaveProperty('id', 'luna-star-garden');
      expect(Array.isArray(res.body.pages)).toBe(true);
      const updatedPage = res.body.pages.find((p: { page_number: number }) => p.page_number === 2);
      expect(updatedPage.illustration_url).toBe(fakeUrl);

      // Other pages should be untouched (no illustration_url set).
      for (const page of res.body.pages) {
        if (page.page_number !== 2) {
          expect(page.illustration_url).toBeNull();
        }
      }

      // Mock was called exactly once for page 2.
      expect(mockGenerateIllustration).toHaveBeenCalledTimes(1);
      expect(mockGenerateIllustration.mock.calls[0][1]).toBe(2);
    });

    // IV2 Phase 2 — reference plumbing through /illustrate.
    // generateIllustration's signature is
    //   (bookId, pageNumber, description, feedback, styleDescriptor, characters, referenceImages, opts)
    // so referenceImages is the 7th positional arg → mock.calls[n][6], and the
    // trailing options object (pin + styleAnchor) is the 8th → mock.calls[n][7].
    const REF_IMAGES_ARG = 6;
    const OPTS_ARG = 7;

    it('threads the style anchor first, then required-cast portrait refs (3 refs)', async () => {
      const token = await setupOwnedDraft();
      // Primary + antagonist have portraits; a supporting character with a
      // portrait must NOT be forced as a reference (spec: required = primary +
      // antagonist only).
      const primaryPortrait = '/illustrations/luna-star-garden/portrait-1000.png';
      const antagonistPortrait = '/illustrations/luna-star-garden/portrait-1001.png';
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: {
          characters_json: JSON.stringify([
            { role: 'primary', name: 'Luna', portrait_url: primaryPortrait },
            { role: 'antagonist', name: 'Shadow', portrait_url: antagonistPortrait },
            { role: 'supporting', name: 'Pip', portrait_url: '/illustrations/luna-star-garden/portrait-1002.png' },
          ]),
        },
      });
      // Page 2 already has art, so this targeted re-roll anchors on it. Anchor
      // + 2 required portraits is exactly MAX_REFERENCE_IMAGES — nothing is
      // truncated, and the anchor holds slot 0 because the prompt names it by
      // position ("Reference image 1").
      const anchorUrl = await illustratePageOnDisk(2);

      mockGenerateIllustration.mockResolvedValue('/illustrations/luna-star-garden/page.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 2 });

      expect(res.status).toBe(200);
      expect(mockGenerateIllustration).toHaveBeenCalledTimes(1);
      const refs = mockGenerateIllustration.mock.calls[0][REF_IMAGES_ARG] as string[];
      expect(refs).toEqual([anchorUrl, primaryPortrait, antagonistPortrait]);
      // The supporting character's portrait is intentionally excluded.
      expect(refs).not.toContain('/illustrations/luna-star-garden/portrait-1002.png');
      // The generator is told which reference is the anchor, not left to infer
      // it from position — that flag is what switches the prompt clauses on.
      expect(mockGenerateIllustration.mock.calls[0][OPTS_ARG]).toMatchObject({
        styleAnchor: anchorUrl,
      });
    });

    it("anchors a targeted re-roll on the page's own existing illustration", async () => {
      const token = await setupOwnedDraft();
      // No portraits on this book, so the anchor is the only reference — the
      // narrow case the mitigation exists for: re-rolling one page of a book
      // whose art already has a style to match.
      const anchorUrl = await illustratePageOnDisk(4);

      mockGenerateIllustration.mockResolvedValue('/illustrations/luna-star-garden/page-4-v2.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 4, feedback: 'more stars in the sky' });

      expect(res.status).toBe(200);
      expect(mockGenerateIllustration).toHaveBeenCalledTimes(1);
      expect(mockGenerateIllustration.mock.calls[0][REF_IMAGES_ARG]).toEqual([anchorUrl]);
      expect(mockGenerateIllustration.mock.calls[0][OPTS_ARG]).toMatchObject({
        styleAnchor: anchorUrl,
      });
    });

    it('drops the anchor (no 500) when the page URL has no file behind it', async () => {
      const token = await setupOwnedDraft();
      // A book restored from another machine: the row remembers a URL, the
      // bytes never came along. Both reference resolvers throw on a missing
      // file, so failing to drop this anchor turns a re-roll into a 500.
      await prisma.page.updateMany({
        where: { book_id: 'luna-star-garden', page_number: 2 },
        data: { illustration_url: '/illustrations/luna-star-garden/page-2-gone.png' },
      });

      mockGenerateIllustration.mockResolvedValue('/illustrations/luna-star-garden/page-2-v2.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 2 });

      expect(res.status).toBe(200);
      // Degrades to today's prompt-only path rather than failing the request.
      expect(mockGenerateIllustration.mock.calls[0][REF_IMAGES_ARG]).toBeUndefined();
      expect(mockGenerateIllustration.mock.calls[0][OPTS_ARG]).toMatchObject({ styleAnchor: null });
    });

    it('never anchors on a bulk illustrate, even when the book already has art', async () => {
      const token = await setupOwnedDraft();
      const primaryPortrait = '/illustrations/luna-star-garden/portrait-1000.png';
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: {
          characters_json: JSON.stringify([
            { role: 'primary', name: 'Luna', portrait_url: primaryPortrait },
          ]),
        },
      });
      // Page 2 has real art on disk. A bulk run skips it (it only targets pages
      // with no illustration_url), and must not borrow it as an anchor for the
      // pages it does draw — those are new art, not re-rolls. Note the route's
      // `pageNumber ?` gate is belt-and-braces: with today's filter every bulk
      // page has a null URL, so this asserts the outcome rather than the gate.
      await illustratePageOnDisk(2);
      // 4 openai-priced pages at 25c each would trip the 50c daily cap and turn
      // this into a partial-result test; the cap is not what is under test here.
      vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '1000');

      mockGenerateIllustration.mockResolvedValue('/illustrations/luna-star-garden/page.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      // 5 seeded pages minus the already-illustrated page 2.
      expect(mockGenerateIllustration).toHaveBeenCalledTimes(4);
      for (const call of mockGenerateIllustration.mock.calls) {
        expect(call[1]).not.toBe(2);
        // Portrait refs still ride every page (unchanged bulk behaviour)...
        expect(call[REF_IMAGES_ARG]).toEqual([primaryPortrait]);
        // ...but no anchor, so the prompt stays byte-identical to today's.
        expect(call[OPTS_ARG]).toMatchObject({ styleAnchor: null });
      }
    });

    it('passes only the primary portrait when antagonist has none (single ref)', async () => {
      const token = await setupOwnedDraft();
      const primaryPortrait = '/illustrations/luna-star-garden/portrait-1000.png';
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: {
          characters_json: JSON.stringify([
            { role: 'primary', name: 'Luna', portrait_url: primaryPortrait },
            { role: 'antagonist', name: 'Shadow', portrait_url: null },
          ]),
        },
      });

      mockGenerateIllustration.mockResolvedValue('/illustrations/luna-star-garden/page.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 3 });

      expect(res.status).toBe(200);
      const refs = mockGenerateIllustration.mock.calls[0][REF_IMAGES_ARG] as string[];
      expect(refs).toEqual([primaryPortrait]);
    });

    it('illustrates a portrait-less book with NO references (byte-identical IV1 fallback, no 403)', async () => {
      const token = await setupOwnedDraft();
      // luna-star-garden's seeded characters_json carries no portrait_url keys —
      // the regression-safe path: the route must illustrate normally and pass
      // NO referenceImages (undefined), never 403.
      mockGenerateIllustration.mockResolvedValue('/illustrations/luna-star-garden/page.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 1 });

      expect(res.status).toBe(200);
      expect(mockGenerateIllustration).toHaveBeenCalledTimes(1);
      // No references threaded → undefined, so the provider stays on the
      // prompt-only (Flux Pro 1.1 / gpt-image-1 generations) path.
      expect(mockGenerateIllustration.mock.calls[0][REF_IMAGES_ARG]).toBeUndefined();
      // Page 1 has never been illustrated, so a targeted re-roll of it has
      // nothing to anchor on either — references AND prompt match today's.
      expect(mockGenerateIllustration.mock.calls[0][OPTS_ARG]).toMatchObject({ styleAnchor: null });
    });

    it('returns 500 with a non-empty JSON error body when generation throws', async () => {
      // This is the regression pin for the reported bug: server must respond
      // with a parseable JSON envelope, NOT 200 + silent success and NOT a
      // non-2xx with an empty body (which is what produced the user-visible
      // "Unexpected end of JSON input" error in the browser).
      const token = await setupOwnedDraft();

      mockGenerateIllustration.mockRejectedValueOnce(
        new Error('OpenAI image API returned 500 Internal Server Error: boom'),
      );

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 1 });

      expect(res.status).toBe(500);
      expect(res.body).toBeDefined();
      expect(typeof res.body.error).toBe('string');
      expect(res.body.error.length).toBeGreaterThan(0);
      expect(res.body.error).toMatch(/Failed to generate illustrations/);
    });

    // ---------------------------------------------------------------------
    // Per-book image pin (spec: reroll-style-consistency, mitigation A).
    // ---------------------------------------------------------------------

    it('pins image_provider and image_model on the illustrate response (wire shape)', async () => {
      const token = await setupOwnedDraft();
      mockGenerateIllustration.mockResolvedValueOnce('/illustrations/luna-star-garden/page-2.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 2 });

      expect(res.status).toBe(200);
      // OPS.3 / ADR-003: pin every field the client depends on by name. The two
      // pin columns ship on every Book response because hydrateBook spreads the
      // whole Prisma row, so they need pinning here or a rename ships silently.
      expect(res.body).toMatchObject({
        id: 'luna-star-garden',
        title: expect.any(String),
        status: expect.any(String),
        version: expect.any(Number),
        characters: expect.any(Array),
        style_descriptor: null,
        image_provider: expect.any(String),
        image_model: expect.any(String),
        created_at: expect.any(String),
        pages: expect.any(Array),
      });
      expect(res.body.pages[0]).toMatchObject({
        id: expect.any(Number),
        book_id: 'luna-star-garden',
        page_number: expect.any(Number),
        text: expect.any(String),
        illustration_description: expect.any(String),
      });
    });

    it('persists the pin on a successful illustrate of an unpinned, unillustrated book', async () => {
      const token = await setupOwnedDraft();
      const before = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(before?.image_provider).toBeNull();

      mockGenerateIllustration.mockResolvedValueOnce('/illustrations/luna-star-garden/page-1.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 1 });

      expect(res.status).toBe(200);
      // No prior art → the pin is the current environment default, and it is
      // written back so inference never runs for this book again.
      const after = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(after?.image_provider).toBe('openai');
      expect(after?.image_model).toBe('gpt-image-1');
      expect(res.body.image_provider).toBe('openai');
    });

    // The pin must describe art that EXISTS. A book with no art resolves to the
    // environment default for the current call only — writing that default to
    // the row on a request that never draws anything records an intention, and
    // if the operator later flips IMAGE_PROVIDER the art gets made by one
    // provider while the row says another: the reported style-drift bug,
    // re-created by the fix meant to prevent it. (Spec, "Alternatives
    // considered → Pin at book-creation time".)
    it('does not pin an art-less book when the request never draws anything (501)', async () => {
      delete process.env.OPENAI_API_KEY;
      const token = await setupOwnedDraft();

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 1 });

      expect(res.status).toBe(501);
      const after = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(after?.image_provider).toBeNull();
      expect(after?.image_model).toBeNull();
    });

    it('does not pin an art-less book when quota blocks the only page', async () => {
      const token = await setupOwnedDraft();
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      // 40c already spent against the default 50c daily cap: spendGate reserves
      // at the default 4c and lets the request through, then the handler's
      // provider-aware check prices this openai-pinned page at 25c and denies.
      await prisma.usageLog.create({
        data: { user_id: user!.id, kind: 'story', cost_cents: 40 },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 1 });

      expect(res.status).toBe(200);
      expect(res.body.quotaHitAfterPage).toBe(0);
      expect(mockGenerateIllustration).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(1);

      // Nothing was drawn, so nothing may be pinned.
      const after = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(after?.image_provider).toBeNull();
      expect(res.body.image_provider).toBeNull();
    });

    it('infers openai from pre-cutover illustration history and threads the pin to the generator', async () => {
      // This is the reported bug in miniature: a book drawn in May must re-roll
      // on gpt-image-1 even though IMAGE_PROVIDER now says fal.
      process.env.IMAGE_PROVIDER = 'fal';
      process.env.FAL_KEY = 'fal-test';
      process.env.OPENAI_API_KEY = 'sk-test';

      const token = await setupOwnedDraft();
      await prisma.illustrationVersion.create({
        data: {
          book_id: 'luna-star-garden',
          page_number: 4,
          version: 1,
          url: '/illustrations/luna-star-garden/page-4.png',
          created_at: new Date('2026-05-19T10:00:00.000Z'),
        },
      });

      mockGenerateIllustration.mockResolvedValueOnce('/illustrations/luna-star-garden/page-4-v2.png');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 4 });

      expect(res.status).toBe(200);
      expect(mockGenerateIllustration.mock.calls[0][OPTS_ARG]).toMatchObject({
        pin: { provider: 'openai', model: 'gpt-image-1' },
      });
      const after = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(after?.image_provider).toBe('openai');
    });

    it('409s a book pinned to a provider this server has no key for, without generating or charging', async () => {
      // The alternative — silently falling back to the configured default — is
      // the exact style drift this whole change exists to remove.
      process.env.IMAGE_PROVIDER = 'fal';
      process.env.FAL_KEY = 'fal-test';
      delete process.env.OPENAI_API_KEY;

      const token = await setupOwnedDraft();
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { image_provider: 'openai', image_model: 'gpt-image-1' },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 2 });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/openai/);
      // Zero provider calls and zero spend: the gate sits before both.
      expect(mockGenerateIllustration).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });

    // Observed live: a `.env` copied from `.env.example` leaves
    // OPENAI_API_KEY=your-api-key-here. Under a presence-only check that counts
    // as configured, so the 409 never fires, the request reaches OpenAI, and
    // the caller gets a 500 carrying the provider's 401 stack trace. The
    // placeholder must read as "no key for this provider" — same 409, same zero
    // side effects, as an unset key.
    it('409s when the pinned provider has only a PLACEHOLDER key and another provider is real', async () => {
      process.env.IMAGE_PROVIDER = 'fal';
      process.env.FAL_KEY = 'fal-test';
      process.env.OPENAI_API_KEY = 'your-api-key-here'; // the .env.example literal

      const token = await setupOwnedDraft();
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { image_provider: 'openai', image_model: 'gpt-image-1' },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 2 });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toMatch(/openai/);
      // Never a silent fallback to the real Fal key, and never a provider call:
      // ADR-013 dec 5.
      expect(mockGenerateIllustration).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });

    it('501s when EVERY provider key is a placeholder', async () => {
      process.env.IMAGE_PROVIDER = 'fal';
      process.env.FAL_KEY = 'your-api-key-here';
      process.env.OPENAI_API_KEY = 'changeme';

      const token = await setupOwnedDraft();
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { image_provider: 'openai', image_model: 'gpt-image-1' },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 2 });

      // 501, not 409: nothing on this server is usable, which is the same
      // situation as nothing being set.
      expect(res.status).toBe(501);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toMatch(/Image generation not configured/);
      expect(mockGenerateIllustration).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });

    it('409 loses to the 404 for a non-owner and to the 403 for a published book', async () => {
      // Ordering per docs/conventions/server.md: ownership, then mutability,
      // then capability. A stranger must never learn that a book exists and is
      // pinned to a provider we lack.
      process.env.IMAGE_PROVIDER = 'fal';
      process.env.FAL_KEY = 'fal-test';
      delete process.env.OPENAI_API_KEY;

      const token = await setupOwnedDraft();
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { image_provider: 'openai', image_model: 'gpt-image-1' },
      });

      // Non-owner: 404, not 409.
      await allowEmail('stranger@example.com');
      const strangerRes = await request(app).post('/api/auth/register').send({
        email: 'stranger@example.com',
        name: 'Stranger',
        password: 'pass1234',
      });
      const stranger = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${strangerRes.body.token}`)
        .send({ pageNumber: 2 });
      expect(stranger.status).toBe(404);

      // Owner, but published: 403, not 409.
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'published' },
      });
      const published = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageNumber: 2 });
      expect(published.status).toBe(403);
      expect(published.body.error).toBe(PUBLISHED_IMMUTABLE_ERROR);

      expect(mockGenerateIllustration).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });
  });

  describe('GET /api/books/:id/illustrations/:pageNumber', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/books/luna-star-garden/illustrations/1');
      expect(res.status).toBe(401);
    });

    it('returns 404 for another user\'s book', async () => {
      const token = await createUserAndGetToken(app);
      const res = await request(app)
        .get('/api/books/luna-star-garden/illustrations/1')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns an empty array for a page with no illustrations and no files', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { created_by: user!.id },
      });

      const res = await request(app)
        .get('/api/books/luna-star-garden/illustrations/1')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns the enriched shape from IllustrationVersion rows', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { created_by: user!.id },
      });

      await prisma.illustrationVersion.createMany({
        data: [
          {
            book_id: 'luna-star-garden',
            page_number: 1,
            version: 1,
            url: '/illustrations/luna-star-garden/page-1.png',
            feedback: null,
          },
          {
            book_id: 'luna-star-garden',
            page_number: 1,
            version: 2,
            url: '/illustrations/luna-star-garden/page-1-v2.png',
            feedback: 'make the moon bigger',
          },
        ],
      });

      const res = await request(app)
        .get('/api/books/luna-star-garden/illustrations/1')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      for (const item of res.body) {
        expect(item).toHaveProperty('url');
        expect(item).toHaveProperty('version');
        expect(item).toHaveProperty('created_at');
        expect(item).toHaveProperty('feedback');
      }
      // versions sorted ascending
      expect(res.body[0].version).toBe(1);
      expect(res.body[0].feedback).toBeNull();
      expect(res.body[1].version).toBe(2);
      expect(res.body[1].feedback).toBe('make the moon bigger');
    });
  });

  describe('POST /api/books/:id/characters/:characterIndex/portrait', () => {
    let originalApiKey: string | undefined;
    let originalProvider: string | undefined;

    let originalFalKey: string | undefined;

    beforeEach(() => {
      mockGenerateCharacterPortrait.mockReset();
      originalApiKey = process.env.OPENAI_API_KEY;
      originalProvider = process.env.IMAGE_PROVIDER;
      originalFalKey = process.env.FAL_KEY;
      // Pin to the openai provider so isImageGenConfigured() gates on
      // OPENAI_API_KEY (the service default is 'fal' → FAL_KEY).
      process.env.IMAGE_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
      // Deterministic regardless of what the developer's shell exports: the
      // 409 case needs FAL_KEY present and OPENAI_API_KEY absent.
      delete process.env.FAL_KEY;
    });

    afterEach(() => {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
      if (originalProvider === undefined) {
        delete process.env.IMAGE_PROVIDER;
      } else {
        process.env.IMAGE_PROVIDER = originalProvider;
      }
      if (originalFalKey === undefined) {
        delete process.env.FAL_KEY;
      } else {
        process.env.FAL_KEY = originalFalKey;
      }
      // Quota limits are stubbed per-test via vi.stubEnv; restore them here so
      // a cap set for the 429 case can't leak into the next test.
      vi.unstubAllEnvs();
    });

    // Claim luna-star-garden as the authed user's draft with a two-character
    // cast so the route's owner-gate and index-range checks have data to work on.
    async function setupOwnedDraftWithCast(): Promise<string> {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: {
          status: 'draft',
          created_by: user!.id,
          characters_json: JSON.stringify([
            { role: 'primary', name: 'Luna', descriptor: 'a curious girl' },
            { role: 'antagonist', name: 'Shadow', descriptor: 'a sly fox' },
          ]),
        },
      });
      return token;
    }

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .send({});
      expect(res.status).toBe(401);
    });

    it('returns 501 when image generation is not configured', async () => {
      delete process.env.OPENAI_API_KEY;
      const token = await setupOwnedDraftWithCast();

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(501);
      expect(res.body.error).toMatch(/Image generation not configured/);
    });

    it('returns 404 for another user\'s book', async () => {
      const token = await createUserAndGetToken(app);
      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it('returns 404 when the character index is out of range', async () => {
      const token = await setupOwnedDraftWithCast();
      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/5/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Character not found/);
    });

    it('generates a portrait and returns the hydrated book with portrait_url set', async () => {
      const token = await setupOwnedDraftWithCast();

      const portraitUrl = '/illustrations/luna-star-garden/portrait-1000.png';
      mockGenerateCharacterPortrait.mockResolvedValueOnce(portraitUrl);

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);

      // Wire-shape assertion (Check 4): pin the full character shape that ships
      // on every hydrated book response, including the new portrait_url field.
      expect(res.body).toMatchObject({
        id: 'luna-star-garden',
        characters: expect.any(Array),
      });
      expect(res.body.characters[0]).toMatchObject({
        role: expect.any(String),
        name: expect.any(String),
        portrait_url: portraitUrl,
      });

      // The mutated character carries the new URL; the other character is
      // untouched (no portrait_url).
      expect(res.body.characters[1].portrait_url).toBeUndefined();

      // Service called with (bookId, index, name, descriptor, feedback, style).
      expect(mockGenerateCharacterPortrait).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateCharacterPortrait.mock.calls[0];
      expect(callArgs[0]).toBe('luna-star-garden');
      expect(callArgs[1]).toBe(0);
      expect(callArgs[2]).toBe('Luna');

      // The patch persisted to characters_json.
      const row = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      const cast = JSON.parse(row!.characters_json!) as { name: string; portrait_url?: string }[];
      expect(cast[0].portrait_url).toBe(portraitUrl);
      expect(cast[1].portrait_url).toBeUndefined();
    });

    it('regenerate with feedback repoints portrait_url to the new version url', async () => {
      const token = await setupOwnedDraftWithCast();

      const v2Url = '/illustrations/luna-star-garden/portrait-1000-v2.png';
      mockGenerateCharacterPortrait.mockResolvedValueOnce(v2Url);

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({ feedback: 'make her hair red' });

      expect(res.status).toBe(200);
      expect(res.body.characters[0].portrait_url).toBe(v2Url);
      // Feedback was forwarded to the service (5th positional arg).
      expect(mockGenerateCharacterPortrait.mock.calls[0][4]).toBe('make her hair red');
    });

    // Spend metering (Task 2). This paid image call ran with no spendGate and
    // no recordUsage, so it was invisible to both the per-user daily cap and
    // the global monthly ceiling — the ceiling sums UsageLog rows that were
    // never written.
    it('records exactly one cover-rate UsageLog row on success', async () => {
      const token = await setupOwnedDraftWithCast();
      mockGenerateCharacterPortrait.mockResolvedValueOnce(
        '/illustrations/luna-star-garden/portrait-1000.png',
      );

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);

      const rows = await prisma.usageLog.findMany();
      expect(rows).toHaveLength(1);
      // Still the `cover` kind — no fourth COST_CENTS entry was added. The rate
      // is now provider-aware: this suite runs with IMAGE_PROVIDER=openai, so
      // the book pins to openai and the portrait is priced at
      // OPENAI_IMAGE_COST_CENTS rather than the 4c Fal rate. Priced through
      // costCentsFor so the assertion can't drift from the implementation.
      expect(rows[0]).toMatchObject({
        kind: 'cover',
        cost_cents: costCentsFor('cover', 'openai'),
      });
      expect(costCentsFor('cover', 'openai')).not.toBe(COST_CENTS.cover);
    });

    it('409s when the book is pinned to a provider this server has no key for', async () => {
      // Same gate as /illustrate: a portrait drawn on the wrong model stops
      // matching the pages it is supposed to keep consistent.
      process.env.IMAGE_PROVIDER = 'fal';
      process.env.FAL_KEY = 'fal-test';
      delete process.env.OPENAI_API_KEY;

      const token = await setupOwnedDraftWithCast();
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { image_provider: 'openai', image_model: 'gpt-image-1' },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/openai/);
      expect(mockGenerateCharacterPortrait).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });

    it('records no usage when the provider returns no url', async () => {
      const token = await setupOwnedDraftWithCast();
      mockGenerateCharacterPortrait.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);

      // A provider miss must not consume quota — usage is recorded only after
      // the paid call actually succeeds.
      expect(await prisma.usageLog.count()).toBe(0);
    });

    it('returns 429 when the daily cap is exhausted, before any provider call', async () => {
      const token = await setupOwnedDraftWithCast();
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      // Same exhaustion pattern the spendGate tests use: a 1c cap with 1c
      // already spent leaves no headroom for a 4c cover-rate call.
      vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '1');
      await prisma.usageLog.create({
        data: { user_id: user!.id, kind: 'story', cost_cents: 1 },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(429);
      // Wire-shape assertion (Check 4): the new 429 envelope.
      expect(res.body).toMatchObject({ error: expect.any(String) });
      // The gate is mounted before the handler, so nothing was generated and
      // nothing new was charged.
      expect(mockGenerateCharacterPortrait).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(1);
    });

    // The middleware alone is not a gate for this route: spendGate('cover')
    // runs before the book — and therefore the pin — is loaded, so it reserves
    // at the default 4c while an openai-pinned portrait records 25c. Checked at
    // one price and charged at another, the difference escapes both ceilings
    // one portrait at a time. The handler-level checkQuota is what closes it.
    it('429s at the PINNED provider rate that spendGate could not price', async () => {
      const token = await setupOwnedDraftWithCast();
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      // 40c spent against the default 50c daily cap. spendGate's 4c reservation
      // fits (44 <= 50) and lets the request through; the pinned 25c does not
      // (65 > 50), so only the handler check can stop it.
      await prisma.usageLog.create({
        data: { user_id: user!.id, kind: 'story', cost_cents: 40 },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(429);
      // Same envelope spendGate itself produces — one shape for the client.
      expect(res.body).toMatchObject({
        error: expect.any(String),
        quota: {
          scope: 'daily',
          spentCents: expect.any(Number),
          limitCents: expect.any(Number),
        },
      });
      expect(res.headers['retry-after']).toBeDefined();

      // Zero provider calls, zero new UsageLog rows: the check sits after the
      // pin and before the paid call, so a denial costs nothing.
      expect(mockGenerateCharacterPortrait).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(1);
      expect(await prisma.usageLog.findMany({ where: { kind: 'cover' } })).toHaveLength(0);
    });

    it('503s on the monthly ceiling at the pinned rate, which no admin bypasses', async () => {
      const token = await setupOwnedDraftWithCast();

      // Monthly ceiling low enough that the pinned 25c overruns it but the
      // middleware's 4c reservation does not.
      vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '10');

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(503);
      // Pinned as fully as the 429 case above — the whole envelope, not just
      // the scope. Both denials come from the same sendQuotaDenied helper, so
      // pinning one loosely would let the other drift unnoticed.
      expect(res.body).toMatchObject({
        error: expect.any(String),
        quota: {
          scope: 'monthly',
          spentCents: expect.any(Number),
          limitCents: expect.any(Number),
        },
      });
      expect(mockGenerateCharacterPortrait).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });

    it('pins an art-less book on the first successful portrait', async () => {
      // The pin is written on the image that actually succeeds, never on the
      // resolve — see the /illustrate "does not pin an art-less book" tests.
      const token = await setupOwnedDraftWithCast();
      const before = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(before?.image_provider).toBeNull();

      mockGenerateCharacterPortrait.mockResolvedValueOnce(
        '/illustrations/luna-star-garden/portrait-1000.png',
      );

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);

      const after = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(after?.image_provider).toBe('openai');
      expect(after?.image_model).toBe('gpt-image-1');
    });

    it('does not pin an art-less book when the portrait is never drawn', async () => {
      const token = await setupOwnedDraftWithCast();
      mockGenerateCharacterPortrait.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);

      const after = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(after?.image_provider).toBeNull();
    });
  });

  describe('GET /api/books/:id/characters/:characterIndex/portraits', () => {
    beforeEach(() => {
      mockListCharacterPortraitVersions.mockReset();
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/books/luna-star-garden/characters/0/portraits');
      expect(res.status).toBe(401);
    });

    it('returns 404 for another user\'s book', async () => {
      const token = await createUserAndGetToken(app);
      const res = await request(app)
        .get('/api/books/luna-star-garden/characters/0/portraits')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns the portrait version list shape', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { created_by: user!.id },
      });

      mockListCharacterPortraitVersions.mockResolvedValueOnce([
        {
          url: '/illustrations/luna-star-garden/portrait-1000.png',
          version: 1,
          created_at: new Date().toISOString(),
          feedback: null,
        },
        {
          url: '/illustrations/luna-star-garden/portrait-1000-v2.png',
          version: 2,
          created_at: new Date().toISOString(),
          feedback: 'make her hair red',
        },
      ]);

      const res = await request(app)
        .get('/api/books/luna-star-garden/characters/0/portraits')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      // Wire-shape assertion (Check 4): pin every field of the version shape.
      expect(res.body[0]).toMatchObject({
        url: expect.any(String),
        version: expect.any(Number),
        created_at: expect.any(String),
        feedback: null,
      });
      expect(res.body[1]).toMatchObject({
        url: expect.any(String),
        version: 2,
        created_at: expect.any(String),
        feedback: 'make her hair red',
      });
      expect(mockListCharacterPortraitVersions).toHaveBeenCalledWith('luna-star-garden', 0);
    });
  });

  // #20 Task 1 — "withdraw to edit": a published book is immutable. Every
  // content-mutating route on a book runs the shared `isEditable` gate AFTER
  // the ownership check, so a stranger still gets 404 and only the owner ever
  // sees the 403.
  describe('published books are immutable', () => {
    let originalProvider: string | undefined;
    let originalOpenAiKey: string | undefined;

    beforeEach(() => {
      mockCreate.mockReset();
      mockGenerateIllustration.mockReset();
      mockGenerateCharacterPortrait.mockReset();
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      originalProvider = process.env.IMAGE_PROVIDER;
      originalOpenAiKey = process.env.OPENAI_API_KEY;
      // Image generation is fully configured here on purpose: the 403 must be
      // the reason these routes stop, not a missing provider key.
      process.env.IMAGE_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
    });

    afterEach(() => {
      if (originalProvider === undefined) delete process.env.IMAGE_PROVIDER;
      else process.env.IMAGE_PROVIDER = originalProvider;
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
    });

    // Claims luna-star-garden as the authed user's book at the given status,
    // with a two-character cast so the portrait route has an index to hit.
    async function setupOwnedBook(status: 'draft' | 'published'): Promise<string> {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: {
          status,
          created_by: user!.id,
          characters_json: JSON.stringify([
            { role: 'primary', name: 'Luna', descriptor: 'a curious girl' },
            { role: 'antagonist', name: 'Shadow', descriptor: 'a sly fox' },
          ]),
        },
      });
      return token;
    }

    async function publishOwnedByStranger(): Promise<void> {
      await allowEmail('stranger@example.com');
      const reg = await request(app).post('/api/auth/register').send({
        email: 'stranger@example.com',
        name: 'Stranger',
        password: 'pass1234',
      });
      const stranger = await prisma.user.findFirst({
        where: { email: 'stranger@example.com' },
      });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'published', created_by: stranger!.id },
      });
      expect(reg.status).toBe(201);
    }

    it('403s PUT /:id/pages/:pageNumber on a published book', async () => {
      const token = await setupOwnedBook('published');

      const res = await request(app)
        .put('/api/books/luna-star-garden/pages/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ illustration_description: 'a new description' });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toBe(PUBLISHED_IMMUTABLE_ERROR);
    });

    it('403s PUT /:id/versions/:version/restore on a published book', async () => {
      const token = await setupOwnedBook('published');
      await prisma.bookVersion.create({
        data: { book_id: 'luna-star-garden', version: 1, pages_json: JSON.stringify([]) },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/versions/1/restore')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toBe(PUBLISHED_IMMUTABLE_ERROR);
    });

    it('403s POST /:id/revise on a published book without calling Claude or charging', async () => {
      const token = await setupOwnedBook('published');

      const res = await request(app)
        .post('/api/books/luna-star-garden/revise')
        .set('Authorization', `Bearer ${token}`)
        .send({ feedback: 'rewrite page 1' });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toBe(PUBLISHED_IMMUTABLE_ERROR);

      // The 403 costs nothing: no provider call, no ledger row. spendGate
      // reserved headroom, but only recordUsage charges.
      expect(mockCreate).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });

    it('403s POST /:id/illustrate on a published book without generating or charging', async () => {
      const token = await setupOwnedBook('published');

      const res = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toBe(PUBLISHED_IMMUTABLE_ERROR);

      expect(mockGenerateIllustration).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });

    it('403s POST /:id/characters/:characterIndex/portrait on a published book', async () => {
      const token = await setupOwnedBook('published');

      const res = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toBe(PUBLISHED_IMMUTABLE_ERROR);

      expect(mockGenerateCharacterPortrait).not.toHaveBeenCalled();
      expect(await prisma.usageLog.count()).toBe(0);
    });

    it('403s PUT /:id/illustrations/:pageNumber/revert on a published book', async () => {
      const token = await setupOwnedBook('published');
      await prisma.page.update({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
        data: { illustration_url: '/illustrations/keep-me.png' },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/illustrations/1/revert')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: '/illustrations/overwrite-me.png' });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toBe(PUBLISHED_IMMUTABLE_ERROR);

      const page = await prisma.page.findUnique({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
      });
      expect(page!.illustration_url).toBe('/illustrations/keep-me.png');
    });

    // Ownership beats status. A stranger must never learn that someone else's
    // book exists, let alone that it is published — so 404, never 403.
    it('404s (not 403s) a non-owner on a published book', async () => {
      const token = await createUserAndGetToken(app);
      await publishOwnedByStranger();

      const revise = await request(app)
        .post('/api/books/luna-star-garden/revise')
        .set('Authorization', `Bearer ${token}`)
        .send({ feedback: 'let me in' });
      expect(revise.status).toBe(404);
      expect(revise.body).toMatchObject({ error: expect.any(String) });

      const illustrate = await request(app)
        .post('/api/books/luna-star-garden/illustrate')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(illustrate.status).toBe(404);
      expect(illustrate.body).toMatchObject({ error: expect.any(String) });

      const portrait = await request(app)
        .post('/api/books/luna-star-garden/characters/0/portrait')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(portrait.status).toBe(404);

      const revert = await request(app)
        .put('/api/books/luna-star-garden/illustrations/1/revert')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: '/illustrations/nope.png' });
      expect(revert.status).toBe(404);

      const pages = await request(app)
        .put('/api/books/luna-star-garden/pages/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ illustration_description: 'nope' });
      expect(pages.status).toBe(404);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockGenerateIllustration).not.toHaveBeenCalled();
      expect(mockGenerateCharacterPortrait).not.toHaveBeenCalled();
    });

    // The gate must not block the state it exists to protect. The revise and
    // illustrate happy paths are already fenced by their own suites; these two
    // routes had no coverage, so their draft path is pinned here.
    it('still lets the owner edit a page and revert an illustration while in draft', async () => {
      const token = await setupOwnedBook('draft');

      const pages = await request(app)
        .put('/api/books/luna-star-garden/pages/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ illustration_description: 'a new description' });
      expect(pages.status).toBe(200);
      expect(pages.body).toMatchObject({ id: 'luna-star-garden', pages: expect.any(Array) });

      // The target must be in page 1's own history (#100) — the revert route no longer
      // accepts an arbitrary string. This is the only change this test needed.
      await prisma.illustrationVersion.create({
        data: {
          book_id: 'luna-star-garden',
          page_number: 1,
          version: 1,
          url: '/illustrations/restored.png',
        },
      });

      const revert = await request(app)
        .put('/api/books/luna-star-garden/illustrations/1/revert')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: '/illustrations/restored.png' });
      expect(revert.status).toBe(200);
      expect(revert.body).toMatchObject({ id: 'luna-star-garden', pages: expect.any(Array) });

      const page = await prisma.page.findUnique({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
      });
      expect(page!.illustration_url).toBe('/illustrations/restored.png');
      expect(page!.illustration_description).toBe('a new description');
    });
  });

  /**
   * #100. Before this, `req.body.url` went straight into `Page.illustration_url` behind
   * nothing but Zod's `.min(1)`. The route is owner- and draft-gated, so there was never
   * a cross-user write — what it allowed was writing arbitrary content into your OWN
   * draft, which then ships to every reader if that draft is published.
   *
   * Each case below is one of the three the issue enumerates, plus the orphan path that
   * had to keep working.
   */
  describe('PUT /api/books/:id/illustrations/:pageNumber/revert — history validation', () => {
    async function setupDraftWithHistory(): Promise<string> {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id },
      });
      await prisma.illustrationVersion.createMany({
        data: [
          { book_id: 'luna-star-garden', page_number: 1, version: 1, url: '/illustrations/luna-star-garden/page-1.png' },
          { book_id: 'luna-star-garden', page_number: 1, version: 2, url: '/illustrations/luna-star-garden/page-1-v2.png' },
          // Page 2's history. Same book, wrong page — the case a per-book check misses.
          { book_id: 'luna-star-garden', page_number: 2, version: 1, url: '/illustrations/luna-star-garden/page-2.png' },
        ],
      });
      return token;
    }

    it('accepts a URL that is in that page’s history', async () => {
      const token = await setupDraftWithHistory();

      const res = await request(app)
        .put('/api/books/luna-star-garden/illustrations/1/revert')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: '/illustrations/luna-star-garden/page-1.png' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'luna-star-garden', pages: expect.any(Array) });

      const page = await prisma.page.findUnique({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
      });
      expect(page!.illustration_url).toBe('/illustrations/luna-star-garden/page-1.png');
    });

    it('rejects an absolute offsite URL', async () => {
      const token = await setupDraftWithHistory();
      const before = await prisma.page.findUnique({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/illustrations/1/revert')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'http://evil.example/x.png' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining('history') });

      // The write must not have happened. Asserting the status alone would pass on a
      // route that 400s *after* updating.
      const after = await prisma.page.findUnique({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
      });
      expect(after!.illustration_url).toBe(before!.illustration_url);
    });

    it('rejects a URL from another page of the same book', async () => {
      const token = await setupDraftWithHistory();

      const res = await request(app)
        .put('/api/books/luna-star-garden/illustrations/1/revert')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: '/illustrations/luna-star-garden/page-2.png' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining('history') });
    });

    it('rejects a junk path that no version ever had', async () => {
      const token = await setupDraftWithHistory();

      const res = await request(app)
        .put('/api/books/luna-star-garden/illustrations/1/revert')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: '/illustrations/nope.png' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining('history') });
    });

    it('still recovers an orphaned page whose illustration_url is null', async () => {
      // #95/#99: the art is on disk and in history, but the book row lost the pointer.
      // This route is the recovery path, so the null-current case must keep working.
      const token = await setupDraftWithHistory();
      await prisma.page.update({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
        data: { illustration_url: null },
      });

      const res = await request(app)
        .put('/api/books/luna-star-garden/illustrations/1/revert')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: '/illustrations/luna-star-garden/page-1-v2.png' });

      expect(res.status).toBe(200);
      const page = await prisma.page.findUnique({
        where: { book_id_page_number: { book_id: 'luna-star-garden', page_number: 1 } },
      });
      expect(page!.illustration_url).toBe('/illustrations/luna-star-garden/page-1-v2.png');
    });
  });

  describe('DELETE /api/books/:id', () => {
    it('soft-deletes a book owned by the user (row remains, deleted_at set)', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { created_by: user!.id },
      });

      const res = await request(app)
        .delete('/api/books/luna-star-garden')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Row should still exist in the DB with deleted_at populated — that's
      // the whole soft-delete contract.
      const row = await prisma.book.findUnique({ where: { id: 'luna-star-garden' } });
      expect(row).not.toBeNull();
      expect(row?.deleted_at).not.toBeNull();

      // ...but the public GET should 404 because of the deleted_at filter.
      const check = await request(app).get('/api/books/luna-star-garden');
      expect(check.status).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).delete('/api/books/luna-star-garden');
      expect(res.status).toBe(401);
    });

    it('returns 404 for another user\'s book', async () => {
      const token = await createUserAndGetToken(app);

      const res = await request(app)
        .delete('/api/books/luna-star-garden')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('soft-delete filtering on read endpoints', () => {
    it('GET /api/books/:id returns 404 for soft-deleted books', async () => {
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { deleted_at: new Date() },
      });

      const res = await request(app).get('/api/books/luna-star-garden');
      expect(res.status).toBe(404);
    });

    it('GET /api/books (catalog) excludes soft-deleted books', async () => {
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { deleted_at: new Date() },
      });

      const res = await request(app).get('/api/books');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(5);
      expect(res.body.find((b: { id: string }) => b.id === 'luna-star-garden')).toBeUndefined();
    });

    it('GET /api/books/mine excludes soft-deleted books', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { created_by: user!.id },
      });
      await prisma.book.update({
        where: { id: 'dinosaur-bakery' },
        data: { created_by: user!.id, deleted_at: new Date() },
      });

      const res = await request(app)
        .get('/api/books/mine')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('luna-star-garden');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/books/:id/pdf — binary wire-shape carve-out
  //
  // OPS.3 / ADR-003 pins JSON response shapes with toMatchObject. This route's
  // 2xx body is a PDF stream, so there is no JSON success shape to pin. The
  // equivalent contract assertions for a binary endpoint are:
  //   1. Content-Type is application/pdf
  //   2. Content-Disposition names an attachment ending in .pdf
  //   3. the body starts with the %PDF- magic bytes
  // Every 4xx/5xx envelope still goes over JSON and is pinned against
  // BookPdfErrorResponseSchema's shape the usual way.
  // -------------------------------------------------------------------------
  describe('POST /api/books/:id/pdf', () => {
    // Supertest's default parser mangles binary bodies — collect the raw
    // chunks ourselves on every test that asserts a 200.
    function asPdf(req: request.Test) {
      return req.buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    }

    async function createOtherUserAndGetToken() {
      await allowEmail('other@example.com');
      const res = await request(app).post('/api/auth/register').send({
        email: 'other@example.com',
        name: 'Other',
        password: 'pass1234',
      });
      return res.body.token as string;
    }

    it('streams a PDF for a published book to any authed user', async () => {
      const token = await createUserAndGetToken(app);
      const res = await asPdf(
        request(app)
          .post('/api/books/luna-star-garden/pdf')
          .set('Authorization', `Bearer ${token}`)
          .send({}),
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/pdf/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename=".+\.pdf"/);
      expect((res.body as Buffer).subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });

    it('names the attachment after the book title', async () => {
      const token = await createUserAndGetToken(app);
      const res = await asPdf(
        request(app)
          .post('/api/books/luna-star-garden/pdf')
          .set('Authorization', `Bearer ${token}`)
          .send({}),
      );

      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="luna-and-the-star-garden.pdf"',
      );
    });

    it('streams a PDF for a draft to its owner', async () => {
      const token = await createUserAndGetToken(app);
      const user = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: user!.id },
      });

      const res = await asPdf(
        request(app)
          .post('/api/books/luna-star-garden/pdf')
          .set('Authorization', `Bearer ${token}`)
          .send({}),
      );

      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/api/books/luna-star-garden/pdf').send({});
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    // requireAuth is mounted before validate(), so a malformed body from an
    // anonymous caller is still a 401 — not a 400. That ordering is
    // load-bearing (docs/conventions/server.md); this pins it.
    it('returns 401, not 400, when an unauthenticated request also has a bad body', async () => {
      const res = await request(app)
        .post('/api/books/luna-star-garden/pdf')
        .send({ unexpected: 'key' });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it('returns 404 for a nonexistent book', async () => {
      const token = await createUserAndGetToken(app);
      const res = await request(app)
        .post('/api/books/nonexistent-id/pdf')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it('returns 404 for a soft-deleted book', async () => {
      const token = await createUserAndGetToken(app);
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { deleted_at: new Date() },
      });

      const res = await request(app)
        .post('/api/books/luna-star-garden/pdf')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it("returns 404 for another user's draft", async () => {
      const ownerToken = await createUserAndGetToken(app);
      expect(ownerToken).toBeTruthy();
      const owner = await prisma.user.findFirst({ where: { email: 'author@example.com' } });
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft', created_by: owner!.id },
      });

      const otherToken = await createOtherUserAndGetToken();
      const res = await request(app)
        .post('/api/books/luna-star-garden/pdf')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it('returns 400 when the body has unexpected keys', async () => {
      const token = await createUserAndGetToken(app);
      const res = await request(app)
        .post('/api/books/luna-star-garden/pdf')
        .set('Authorization', `Bearer ${token}`)
        .send({ unexpected: 'key' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it('accepts a request with no body at all', async () => {
      const token = await createUserAndGetToken(app);
      const res = await asPdf(
        request(app).post('/api/books/luna-star-garden/pdf').set('Authorization', `Bearer ${token}`),
      );
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });
  });
});
