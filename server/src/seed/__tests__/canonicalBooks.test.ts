import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { CharacterSchema } from '@storybook/shared';
import prisma from '../../db/prisma';
import { resetDatabase } from '../../__tests__/setup';
import { CANONICAL_BOOKS, SEED_BOOK_IDS, seedCanonicalBooks } from '../canonicalBooks';

describe('CANONICAL_BOOKS data', () => {
  it('has exactly the 6 seed ids, 5 pages each, and no created_by', () => {
    expect(CANONICAL_BOOKS.map((b) => b.id)).toEqual([...SEED_BOOK_IDS]);
    for (const book of CANONICAL_BOOKS) {
      expect(book.pages).toHaveLength(5);
      expect(book).not.toHaveProperty('created_by');
    }
  });

  it('has a cast that parses under CharacterSchema with at least one primary', () => {
    for (const book of CANONICAL_BOOKS) {
      const parsed = z.array(CharacterSchema).parse(book.characters);
      expect(parsed.some((c) => c.role === 'primary')).toBe(true);
      // Art arrives in a later task; no portrait yet.
      for (const c of parsed) expect(c.portrait_url).toBeUndefined();
    }
  });
});

describe('seedCanonicalBooks', () => {
  beforeEach(async () => {
    await resetDatabase();
    // resetDatabase leaves 5 art-less Luna pages; start from a seed-free book table.
    await prisma.page.deleteMany();
    await prisma.book.deleteMany();
  });

  it('never passes coverScene to prisma', async () => {
    const upsert = vi.spyOn(prisma.book, 'upsert');
    await seedCanonicalBooks(prisma);
    expect(upsert).toHaveBeenCalledTimes(6);
    for (const [args] of upsert.mock.calls) {
      expect(args.create).not.toHaveProperty('coverScene');
      expect(args.update).not.toHaveProperty('coverScene');
    }
    upsert.mockRestore();
    const luna = await prisma.book.findUniqueOrThrow({ where: { id: 'luna-star-garden' } });
    expect(JSON.stringify(luna)).not.toContain('star-flowers in silver');
  });

  it('writes rows matching CANONICAL_BOOKS, with no art fields', async () => {
    const result = await seedCanonicalBooks(prisma);
    expect(result).toEqual({ books: 6, pages: 30 });
    for (const book of CANONICAL_BOOKS) {
      const row = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
      expect(row.title).toBe(book.title);
      expect(row.style_descriptor).toBe(book.style_descriptor);
      expect(JSON.parse(row.characters_json!)).toEqual(book.characters);
      expect(row.created_by).toBeNull();
      expect(row.cover_url).toBeNull();
      expect(row.image_provider).toBeNull();
    }
    expect(await prisma.page.count({ where: { illustration_url: { not: null } } })).toBe(0);
  });

  it('is idempotent: identical rows on a second run, page count stays 30', async () => {
    await seedCanonicalBooks(prisma);
    const first = {
      books: await prisma.book.findMany({ orderBy: { id: 'asc' } }),
      pages: await prisma.page.findMany({ orderBy: [{ book_id: 'asc' }, { page_number: 'asc' }] }),
    };
    await seedCanonicalBooks(prisma);
    const second = {
      books: await prisma.book.findMany({ orderBy: { id: 'asc' } }),
      pages: await prisma.page.findMany({ orderBy: [{ book_id: 'asc' }, { page_number: 'asc' }] }),
    };
    expect(second).toEqual(first);
    expect(second.pages).toHaveLength(30);
  });

  it('leaves deleted_at unchanged on a soft-deleted seed book', async () => {
    await seedCanonicalBooks(prisma);
    const deletedAt = new Date('2026-01-02T03:04:05.000Z');
    await prisma.book.update({ where: { id: 'cloud-painter' }, data: { deleted_at: deletedAt } });
    await seedCanonicalBooks(prisma);
    const row = await prisma.book.findUniqueOrThrow({ where: { id: 'cloud-painter' } });
    expect(row.deleted_at).toEqual(deletedAt);
  });

  it('leaves a user-created book byte-identical', async () => {
    const user = await prisma.user.create({
      data: { email: 'seed-test@example.com', name: 'Seed Test', password_hash: 'x' },
    });
    await prisma.book.create({
      data: {
        id: 'user-book-1', title: 'Mine', author: 'Me', description: 'd', theme: 't',
        age_range: '3-6', cover_emoji: 'x', cover_color: '#000', price: 1,
        is_user_created: true, created_by: user.id, style_descriptor: 'custom',
      },
    });
    await prisma.page.create({
      data: { book_id: 'user-book-1', page_number: 1, text: 'hi', illustration_description: 'd', illustration_url: '/illustrations/user-book-1/page-1.png' },
    });
    const before = {
      book: await prisma.book.findUniqueOrThrow({ where: { id: 'user-book-1' } }),
      pages: await prisma.page.findMany({ where: { book_id: 'user-book-1' } }),
    };
    await seedCanonicalBooks(prisma);
    const after = {
      book: await prisma.book.findUniqueOrThrow({ where: { id: 'user-book-1' } }),
      pages: await prisma.page.findMany({ where: { book_id: 'user-book-1' } }),
    };
    expect(after).toEqual(before);
  });
});
