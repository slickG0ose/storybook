import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import prisma from '../db/prisma';
import { resetDatabase } from './setup';

/**
 * Pins the referential behaviour of the `Feedback` model (#157, spec §Data model).
 *
 * - `onDelete: Cascade` on the user, so the test-only hard delete
 *   (`DELETE /api/_test/user-by-email`) keeps working once a user has submitted
 *   feedback. With the default `Restrict` every e2e `deleteUsers()` would fail.
 * - `onDelete: SetNull` on the book, so feedback outlives a deleted book.
 * - `status` defaults to `'new'` and `recent_errors_json` to null.
 */

async function createUser(email: string) {
  return prisma.user.create({
    data: { email, name: 'Tester', password_hash: 'not-a-real-hash' },
  });
}

function feedbackData(user_id: string, book_id: string | null = null) {
  return {
    user_id,
    session_id: '00000000-0000-4000-8000-000000000000',
    category: 'bug',
    message: 'The page button did nothing.',
    route: '/books/luna-star-garden',
    book_id,
    viewport_width: 390,
    viewport_height: 844,
    theme: 'dark',
  };
}

describe('Feedback model', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('defaults status to new and recent_errors_json to null', async () => {
    const user = await createUser('feedback-defaults@test.local');
    const row = await prisma.feedback.create({ data: feedbackData(user.id) });

    expect(row).toMatchObject({
      status: 'new',
      recent_errors_json: null,
      book_id: null,
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
    });
  });

  it('cascades feedback rows when the user is hard-deleted', async () => {
    const user = await createUser('feedback-cascade@test.local');
    const other = await createUser('feedback-bystander@test.local');
    await prisma.feedback.create({ data: feedbackData(user.id) });
    await prisma.feedback.create({ data: feedbackData(user.id) });
    await prisma.feedback.create({ data: feedbackData(other.id) });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.feedback.count({ where: { user_id: user.id } })).toBe(0);
    expect(await prisma.feedback.count({ where: { user_id: other.id } })).toBe(1);
  });

  it('sets book_id to null when the book is hard-deleted', async () => {
    const user = await createUser('feedback-setnull@test.local');
    const book = await prisma.book.create({
      data: {
        title: 'Disposable Book',
        author: 'Test',
        description: 'Deleted mid-test.',
        theme: 'fantasy',
        age_range: '4-7',
        cover_emoji: '\u{1F4D5}',
        cover_color: '#000000',
        price: 1,
      },
    });
    const row = await prisma.feedback.create({ data: feedbackData(user.id, book.id) });
    expect(row.book_id).toBe(book.id);

    await prisma.book.delete({ where: { id: book.id } });

    const after = await prisma.feedback.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.book_id).toBeNull();
    expect(after.message).toBe('The page button did nothing.');
  });
});
