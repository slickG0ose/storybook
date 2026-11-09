import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import { resetDatabase } from './setup';

/**
 * NarrationClip storage invariants (spec: .code-captain/specs/generated-narration).
 *
 * The unique key is what makes concurrent first-Play safe: the losing `create`
 * hits P2002 and reads the winner's row instead of billing twice. The cascade is
 * what lets a hard book delete leave no orphaned clip rows behind.
 */

const BOOK_ID = 'luna-star-garden';

function clip(overrides: Partial<Prisma.NarrationClipUncheckedCreateInput> = {}) {
  return {
    book_id: BOOK_ID,
    slot: 'p1',
    voice_id: 'af_heart',
    model: 'fal-ai/kokoro/american-english',
    text_hash: 'a'.repeat(64),
    chars: 11,
    segments_json: JSON.stringify([
      { index: 0, start: 0, end: 11, key: `${BOOK_ID}/narration/p1-af_heart-aaaaaaaaaaaaaaaa-0.wav`, durationMs: 900 },
    ]),
    created_by: null,
    ...overrides,
  } satisfies Prisma.NarrationClipUncheckedCreateInput;
}

describe('NarrationClip model', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('rejects a duplicate (book_id, slot, voice_id, model, text_hash) with P2002', async () => {
    await prisma.narrationClip.create({ data: clip() });

    const dup = prisma.narrationClip.create({ data: clip({ chars: 99, created_by: 'someone-else' }) });
    await expect(dup).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.narrationClip.count({ where: { book_id: BOOK_ID } })).toBe(1);
  });

  it('allows rows that differ in any one key column', async () => {
    await prisma.narrationClip.create({ data: clip() });
    await prisma.narrationClip.create({ data: clip({ slot: 'p2' }) });
    await prisma.narrationClip.create({ data: clip({ voice_id: 'am_michael' }) });
    await prisma.narrationClip.create({ data: clip({ model: 'fal-ai/kokoro/other' }) });
    await prisma.narrationClip.create({ data: clip({ text_hash: 'b'.repeat(64) }) });
    await prisma.narrationClip.create({ data: clip({ book_id: 'dinosaur-bakery' }) });

    expect(await prisma.narrationClip.count()).toBe(6);
  });

  it('cascades: hard-deleting a book removes its clips and leaves other books alone', async () => {
    await prisma.narrationClip.create({ data: clip() });
    await prisma.narrationClip.create({ data: clip({ slot: 'cover' }) });
    await prisma.narrationClip.create({ data: clip({ book_id: 'dinosaur-bakery' }) });

    // Pages also cascade from Book, so the book delete needs nothing else first.
    await prisma.book.delete({ where: { id: BOOK_ID } });

    expect(await prisma.narrationClip.count({ where: { book_id: BOOK_ID } })).toBe(0);
    expect(await prisma.narrationClip.count({ where: { book_id: 'dinosaur-bakery' } })).toBe(1);
  });
});
