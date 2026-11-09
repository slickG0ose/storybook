import { describe, it, expect } from 'vitest'
import {
  narrationTextFor,
  nextSlot,
  slotKey,
  GENERATED_VOICE_PREFIX,
  NARRATION_VOICES,
  NarrationVoiceIdSchema,
  NarrationSlotSchema,
  NarrationGenerateRequestSchema,
  NarrationGetResponseSchema,
} from '@storybook/shared'

/*
 * Shared-logic tests for `@storybook/shared/narration`. They live under client because
 * `shared/` has no test runner (generated-narration Task 1).
 */

const book = {
  title: 'Luna and the Star',
  author: 'Ada Lovelace',
  pages: [
    { page_number: 1, text: 'Luna found a star. It was warm.' },
    { page_number: 2, text: '"Stop!" said the fox.' },
    { page_number: 3, text: 'The star went home.' },
  ],
}

describe('narrationTextFor', () => {
  // These literals are exactly what BookSpread built inline before the move. If either
  // drifts, generated offsets stop lining up with the on-screen highlight.
  it('reads title and author for the cover, string-identical to the old BookSpread text', () => {
    expect(narrationTextFor(book, 'cover')).toBe(`${book.title}. By ${book.author}.`)
    expect(narrationTextFor(book, 'cover')).toBe('Luna and the Star. By Ada Lovelace.')
  })

  it('reads "The End." for the end slot', () => {
    expect(narrationTextFor(book, 'end')).toBe('The End.')
  })

  it("returns the page's text verbatim for a page number", () => {
    expect(narrationTextFor(book, 2)).toBe(book.pages[1]!.text)
  })

  it('returns null for a page number the book does not have', () => {
    expect(narrationTextFor(book, 4)).toBeNull()
    expect(narrationTextFor({ ...book, pages: [] }, 1)).toBeNull()
  })
})

describe('slotKey', () => {
  it('maps cover/end through and pages to p<N>', () => {
    expect(slotKey('cover')).toBe('cover')
    expect(slotKey('end')).toBe('end')
    expect(slotKey(3)).toBe('p3')
  })
})

describe('nextSlot', () => {
  it('walks cover → every page ascending → end → null', () => {
    const order: unknown[] = []
    let slot: ReturnType<typeof nextSlot> = 'cover'
    while (slot !== null) {
      order.push(slot)
      slot = nextSlot(slot, [3, 1, 2])
    }
    expect(order).toEqual(['cover', 1, 2, 3, 'end'])
  })

  it('goes straight from cover to end for a book with zero pages', () => {
    expect(nextSlot('cover', [])).toBe('end')
    expect(nextSlot('end', [])).toBeNull()
  })

  it('returns null for a page slot the book does not have', () => {
    expect(nextSlot(9, [1, 2])).toBeNull()
  })
})

describe('narration schemas', () => {
  it('NarrationGenerateRequestSchema accepts voiceId + slot and rejects an extra text key', () => {
    expect(NarrationGenerateRequestSchema.safeParse({ voiceId: 'af_heart', slot: 'cover' }).success).toBe(true)
    expect(NarrationGenerateRequestSchema.safeParse({ voiceId: 'am_michael', slot: 2 }).success).toBe(true)
    expect(
      NarrationGenerateRequestSchema.safeParse({ voiceId: 'af_heart', slot: 1, text: 'say anything' }).success,
    ).toBe(false)
  })

  it('NarrationSlotSchema rejects 0, -1, and the storage form p3', () => {
    expect(NarrationSlotSchema.safeParse(0).success).toBe(false)
    expect(NarrationSlotSchema.safeParse(-1).success).toBe(false)
    expect(NarrationSlotSchema.safeParse('p3').success).toBe(false)
    expect(NarrationSlotSchema.safeParse(1.5).success).toBe(false)
    expect(NarrationSlotSchema.safeParse(1).success).toBe(true)
    expect(NarrationSlotSchema.safeParse('cover').success).toBe(true)
    expect(NarrationSlotSchema.safeParse('end').success).toBe(true)
  })

  it('NarrationGetResponseSchema discriminates on status and requires at least one segment', () => {
    expect(NarrationGetResponseSchema.safeParse({ status: 'missing' }).success).toBe(true)
    const ready = {
      status: 'ready',
      voiceId: 'af_heart',
      slot: 1,
      textHash: 'abc',
      cached: true,
      segments: [{ index: 0, start: 0, end: 19, url: '/illustrations/b/narration/p1.wav', durationMs: 1200 }],
    }
    expect(NarrationGetResponseSchema.safeParse(ready).success).toBe(true)
    expect(NarrationGetResponseSchema.safeParse({ ...ready, segments: [] }).success).toBe(false)
  })

  it('every catalog voice id is accepted by NarrationVoiceIdSchema', () => {
    for (const v of NARRATION_VOICES) {
      expect(NarrationVoiceIdSchema.safeParse(v.id).success).toBe(true)
    }
    expect(GENERATED_VOICE_PREFIX).toBe('generated:')
  })
})
