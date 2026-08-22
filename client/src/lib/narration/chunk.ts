import type { NarrationChunk } from './types'

/**
 * Chrome silently truncates a single utterance past ~15s / ~200-250 chars and can wedge
 * the whole synthesis queue doing it (chromium#41346274). This is a correctness limit,
 * not a tuning knob — raising it trades a highlight nicety for silent truncation.
 */
export const MAX_CHUNK_CHARS = 200

/** Sentence terminators, including the single-character ellipsis. */
const TERMINATORS = new Set(['.', '!', '?', '…'])

/**
 * Characters allowed between a terminator and the whitespace that ends a sentence.
 * Children's-book dialogue is full of `!"` / `?'` / `."`, and splitting *before* the
 * closing quote would strand it at the head of the next chunk.
 */
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»'])

/**
 * Deliberately tiny and literal. Sentence segmentation is an NLP problem; this is a
 * storefront. These five cover essentially every abbreviation that shows up in a
 * children's story, and anything past them is not worth the maintenance.
 */
const ABBREVIATIONS = new Set(['Mr', 'Mrs', 'Ms', 'Dr', 'St'])

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch)
}

/** True when the word immediately before `dotIndex` is one of the known abbreviations. */
function endsWithAbbreviation(text: string, dotIndex: number): boolean {
  let start = dotIndex
  while (start > 0 && /[A-Za-z]/.test(text[start - 1] as string)) start--
  return ABBREVIATIONS.has(text.slice(start, dotIndex))
}

/**
 * Splits `text` into contiguous sentence spans. Trailing whitespace is folded into the
 * span it follows, so the spans tile the entire string with no gaps — that is what makes
 * the round-trip invariant (`chunks.map(c => text.slice(c.start, c.end)).join('')`)
 * hold, and it is why a highlight visually includes its own punctuation and trailing
 * space rather than flickering between words.
 */
function sentenceSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  let start = 0
  let i = 0

  while (i < text.length) {
    const ch = text[i] as string
    if (!TERMINATORS.has(ch)) {
      i++
      continue
    }
    if (ch === '.' && endsWithAbbreviation(text, i)) {
      i++
      continue
    }

    let j = i + 1
    while (j < text.length && CLOSERS.has(text[j] as string)) j++

    // A terminator only ends a sentence when whitespace (or the end of the text)
    // follows. This is also what keeps `3.5` and `Wait...` from splitting mid-token.
    if (j < text.length && !isWhitespace(text[j])) {
      i++
      continue
    }

    while (j < text.length && isWhitespace(text[j])) j++
    spans.push([start, j])
    start = j
    i = j
  }

  if (start < text.length) spans.push([start, text.length])
  return spans
}

/**
 * Splits page text into speakable chunks with offsets back into the original string.
 *
 * Rules, in order:
 * 1. Split on sentence terminators (`.` `!` `?` `…`) plus any trailing closing
 *    quote/bracket and the whitespace that follows.
 * 2. Never split on a terminator that belongs to a known short abbreviation.
 * 3. Hard-split anything still longer than `maxChars` at the last word boundary before
 *    the limit; a single over-long word is split mid-word rather than emitted over-length.
 * 4. `text` is trimmed, but `start`/`end` keep pointing at the untrimmed span.
 * 5. Empty or whitespace-only input returns `[]`, and no zero-length chunk is ever emitted.
 */
export function splitIntoUtterances(text: string, maxChars: number = MAX_CHUNK_CHARS): NarrationChunk[] {
  if (text.trim().length === 0) return []

  const limit = Math.max(1, Math.floor(maxChars))
  const chunks: NarrationChunk[] = []
  // Holds leading whitespace that precedes the first real chunk, so coverage stays
  // contiguous from index 0 without emitting a whitespace-only chunk.
  let pendingStart: number | null = null

  const emit = (spanStart: number, spanEnd: number): void => {
    if (spanEnd <= spanStart) return
    const from = pendingStart ?? spanStart
    const body = text.slice(from, spanEnd)

    if (body.trim().length === 0) {
      // Whitespace-only region: fold it into the previous chunk rather than dropping it
      // (which would break the round-trip) or emitting an empty one.
      const last = chunks[chunks.length - 1]
      if (last) {
        last.end = spanEnd
        pendingStart = null
      } else {
        pendingStart = from
      }
      return
    }

    pendingStart = null
    chunks.push({ text: body.trim(), start: from, end: spanEnd })
  }

  for (const [spanStart, spanEnd] of sentenceSpans(text)) {
    let cursor = spanStart

    while (spanEnd - cursor > limit) {
      const hardLimit = cursor + limit
      let breakAt = -1
      for (let i = hardLimit; i > cursor; i--) {
        if (isWhitespace(text[i])) {
          breakAt = i
          break
        }
      }

      if (breakAt === -1) {
        // A single word longer than the limit. Splitting mid-word is ugly; an
        // over-length utterance is silently truncated by the engine, which is worse.
        emit(cursor, hardLimit)
        cursor = hardLimit
        continue
      }

      let runEnd = breakAt
      while (runEnd < spanEnd && isWhitespace(text[runEnd])) runEnd++
      emit(cursor, runEnd)
      cursor = runEnd
    }

    emit(cursor, spanEnd)
  }

  return chunks
}
