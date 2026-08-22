import { describe, it, expect } from 'vitest'
import { splitIntoUtterances, MAX_CHUNK_CHARS } from '../chunk'
import type { NarrationChunk } from '../types'

/** `chunks.map(c => text.slice(c.start, c.end)).join('')` must reproduce the input exactly. */
function roundTrip(text: string, chunks: NarrationChunk[]): string {
  return chunks.map((c) => text.slice(c.start, c.end)).join('')
}

describe('splitIntoUtterances', () => {
  it('splits multi-sentence prose one chunk per sentence', () => {
    const text = 'Luna found a star. It was warm. She smiled!'
    const chunks = splitIntoUtterances(text)

    expect(chunks.map((c) => c.text)).toEqual([
      'Luna found a star.',
      'It was warm.',
      'She smiled!',
    ])
  })

  it('keeps offsets pointing at the untrimmed span, so text.slice covers the trailing space', () => {
    const text = 'One. Two.'
    const chunks = splitIntoUtterances(text)

    expect(chunks[0]).toEqual({ text: 'One.', start: 0, end: 5 })
    expect(text.slice(chunks[0]!.start, chunks[0]!.end)).toBe('One. ')
    expect(chunks[1]).toEqual({ text: 'Two.', start: 5, end: 9 })
  })

  it('round-trips: no character is dropped or duplicated', () => {
    const text =
      '  Luna found a star.   "Stop!" said the fox. Mr. Fox ran away… did he?\n\nThe end.  '
    const chunks = splitIntoUtterances(text)

    expect(roundTrip(text, chunks)).toBe(text)
  })

  it('round-trips through the hard-split path too', () => {
    const text = `${'word '.repeat(120)}And a final sentence.`
    const chunks = splitIntoUtterances(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(roundTrip(text, chunks)).toBe(text)
  })

  // Rule 3's motivating case: Chrome truncates a long utterance and can wedge the queue,
  // so a run-on with no terminator at all must still come back inside the limit.
  it('never exceeds MAX_CHUNK_CHARS on a 2000-character run-on with no terminator', () => {
    const text = 'the quick brown fox jumps over the lazy dog '.repeat(50).slice(0, 2000)
    expect(text.length).toBe(2000)
    expect(text).not.toMatch(/[.!?…]/)

    const chunks = splitIntoUtterances(text)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThan(0)
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
    expect(roundTrip(text, chunks)).toBe(text)
  })

  it('splits a single over-long word mid-word rather than emitting an over-length chunk', () => {
    const text = 'a'.repeat(450)
    const chunks = splitIntoUtterances(text)

    expect(chunks).toHaveLength(3)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
    expect(roundTrip(text, chunks)).toBe(text)
  })

  it('respects an explicit maxChars', () => {
    const text = 'one two three four five six seven eight nine ten'
    const chunks = splitIntoUtterances(text, 12)

    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(12)
    }
    expect(roundTrip(text, chunks)).toBe(text)
  })

  it('splits dialogue after the closing quote, not before it', () => {
    const text = '"Stop!" said Luna.'
    const chunks = splitIntoUtterances(text)

    expect(chunks.map((c) => c.text)).toEqual(['"Stop!"', 'said Luna.'])
  })

  it('does not split a known abbreviation', () => {
    expect(splitIntoUtterances('Mr. Fox ran.').map((c) => c.text)).toEqual(['Mr. Fox ran.'])
    expect(splitIntoUtterances('Dr. Bell and Mrs. Ito waited.').map((c) => c.text)).toEqual([
      'Dr. Bell and Mrs. Ito waited.',
    ])
  })

  it('splits on an ellipsis', () => {
    expect(splitIntoUtterances('Wait… what?').map((c) => c.text)).toEqual(['Wait…', 'what?'])
  })

  it('does not split a decimal, because no whitespace follows the terminator', () => {
    expect(splitIntoUtterances('It cost 3.50 coins.').map((c) => c.text)).toEqual([
      'It cost 3.50 coins.',
    ])
  })

  it('returns [] for empty and whitespace-only input', () => {
    expect(splitIntoUtterances('')).toEqual([])
    expect(splitIntoUtterances('   ')).toEqual([])
    expect(splitIntoUtterances('\n\t  \n')).toEqual([])
  })

  it('produces monotonically non-decreasing, non-overlapping offsets covering the text', () => {
    const text = '  First one!   Second one? Third one — a long tail that keeps going and going.  '
    const chunks = splitIntoUtterances(text)

    expect(chunks[0]!.start).toBe(0)
    expect(chunks[chunks.length - 1]!.end).toBe(text.length)

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      expect(chunk.end).toBeGreaterThan(chunk.start)
      expect(chunk.text.length).toBeGreaterThan(0)
      const next = chunks[i + 1]
      if (next) expect(next.start).toBe(chunk.end)
    }
  })
})
