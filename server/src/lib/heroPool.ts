/**
 * Hero-rotation pool resolution (spec: `.code-captain/specs/hero-rotation/spec.md`).
 *
 * The frames `GET /api/hero/pool` hands the Home hero to rotate through *after* first
 * paint. Frame 0 of the on-screen rotation is the bundled asset in
 * `client/src/assets/hero/` and never comes from here — this module only ever describes
 * the derived, committed, byte-budgeted WebPs served from `server/public/hero/`.
 *
 * Sibling of `availability.ts`: same job (one shared `where` fragment instead of a
 * predicate re-typed into each route), different question.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HeroFrame } from '@storybook/shared';
import prisma from '../db/prisma';

/**
 * The ONLY expression of hero-pool eligibility. Mirrors `AVAILABLE_BOOK_WHERE`.
 *
 * `hero_consent_at` is what separates "good enough for the front page" (editorial,
 * admin-set via `PUT /api/admin/books/:id/hero-eligible`) from "this book's owner agreed
 * to promotional display" (consent). Two columns, two writers, two actors — an admin
 * flagging a book is not that book's owner agreeing to be advertised with, and a handler
 * that conflated them would be publishing a stranger's art to every visitor.
 *
 * No API writes `hero_consent_at` today. The only writer is the demo-seed fixture, i.e.
 * the operator consenting to the operator's own demo book. That is the seam, not an
 * oversight — see `.code-captain/specs/hero-rotation/spec.md` §"The consent seam".
 *
 * No route writes its own version of this. If a new condition is needed it goes here, so
 * the next reader can answer "what can appear in the hero?" from one expression.
 */
export const HERO_POOL_WHERE = {
  deleted_at: null,
  status: 'published',
  is_hero_eligible: true,
  hero_consent_at: { not: null },
} as const;

/**
 * Total frames the pool will ever return, and the most any single book may contribute.
 *
 * The per-book cap is why the unit is a *frame* and not a book: one book yields several
 * illustrated pages, and without it today's single demo book would be the entire
 * rotation forever. Both are also a data-transfer ceiling — a visitor who watches a full
 * cycle downloads at most `MAX_POOL_FRAMES` frames.
 */
export const MAX_POOL_FRAMES = 5;
export const MAX_FRAMES_PER_BOOK = 2;

/**
 * Intrinsic dimensions of the derived 960 variant, hard-coded rather than probed.
 *
 * 1:1 is locked (ADR-014 decision 6): every illustration this product emits is
 * 1024×1024 and the derive script downscales without cropping, so every artifact under
 * `server/public/hero/` is 960×960 by construction. Reading the real dimensions would
 * mean decoding each WebP on every request — a native image dependency the spec
 * explicitly refuses — to learn a constant the derive contract already fixes.
 *
 * These travel on the wire so the client can reserve the box and keep CLS at zero.
 */
export const HERO_FRAME_WIDTH = 960;
export const HERO_FRAME_HEIGHT = 960;

/** Longest alt text this module will emit. Also the cap the unit test pins. */
export const MAX_ALT_CHARS = 160;

/** Absolute path of the served artifact directory: `server/public/hero/`. */
const HERO_PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public', 'hero');

/**
 * `<book_id>/p<page_number>-{480,960}.webp` — the naming convention IS the lookup key.
 * There is no manifest; `heroFrameAssets.test.ts` pins the convention from the other side
 * so a misfiled frame fails a test rather than going silently invisible.
 */
function frameFilename(pageNumber: number, variant: 480 | 960): string {
  return `p${pageNumber}-${variant}.webp`;
}

/** Server-relative URL, matching the `api(page.illustration_url)` convention. */
function frameUrl(bookId: string, pageNumber: number, variant: 480 | 960): string {
  return `/hero/${bookId}/${frameFilename(pageNumber, variant)}`;
}

/**
 * Memo over `existsSync`, keyed by `<book_id>/<filename>`.
 *
 * The artifact set is committed and only changes on deploy, so re-`stat`ing it on every
 * request is pure cost on a public route. It does mean a file added while the process is
 * running is not seen until restart — which is why `__resetHeroFrameCache()` exists.
 */
const frameExistsCache = new Map<string, boolean>();

/**
 * A frame exists only if its derived artifact exists. Setting `is_hero_eligible` without
 * running `server/scripts/derive-hero-frames.sh` therefore does nothing visible — which
 * is exactly why the admin toggle's response carries `hero_frames_available`, so the
 * operator sees `0` and knows the derive step is still outstanding.
 *
 * Gated on the 960 variant alone, per the resolver contract in the task plan. The derive
 * script always emits the pair, so a 960 without its 480 sibling means someone deleted
 * half a frame by hand.
 */
function heroFrameExists(bookId: string, pageNumber: number): boolean {
  const key = `${bookId}/${frameFilename(pageNumber, 960)}`;
  const cached = frameExistsCache.get(key);
  if (cached !== undefined) return cached;

  const exists = existsSync(join(HERO_PUBLIC_DIR, bookId, frameFilename(pageNumber, 960)));
  frameExistsCache.set(key, exists);
  return exists;
}

/** Test seam for the `existsSync` memo. Call it whenever a test changes what is on disk. */
export function __resetHeroFrameCache(): void {
  frameExistsCache.clear();
}

/**
 * How many of this book's pages have a derived 960 artifact on disk.
 *
 * This is the operator-facing half of the artifact gate, and the reason
 * `PUT /api/admin/books/:id/hero-eligible` answers with more than `BookWithPagesSchema`:
 * flagging a book whose frames were never derived changes nothing a visitor can see, and
 * `hero_frames_available: 0` is how the admin finds that out instead of assuming the
 * front page changed.
 *
 * Deliberately **not** a pool preview. It ignores `HERO_POOL_WHERE` (status, soft-delete,
 * consent) and ignores `MAX_FRAMES_PER_BOOK`, because it answers "did the derive script
 * run?" and not "will this appear in the hero?" — a book can legitimately report 2 frames
 * and still contribute none, e.g. while it is a draft or while its owner has not
 * consented. Answering the pool question here would report `0` for an underived book and
 * `0` for an unconsented one, collapsing the one distinction the number exists to make.
 *
 * Shares `heroFrameExists` with `resolveHeroPool` so there is still exactly one predicate
 * for "a frame exists", memo and all.
 */
export function countHeroFrames(bookId: string, pageNumbers: number[]): number {
  return pageNumbers.filter(pageNumber => heroFrameExists(bookId, pageNumber)).length;
}

/**
 * First sentence of the generation prompt, capped — it describes the art, which is what
 * alt text is for. The full prompt runs to several hundred characters of styling and
 * staging notes that a screen-reader user would have to sit through to reach the subject.
 *
 * Falls back to the book title when the description is empty, so the alt is never blank.
 */
export function deriveAlt(illustrationDescription: string, bookTitle: string): string {
  const description = illustrationDescription.trim();

  // Terminator followed by whitespace or end-of-string, so a mid-sentence "1024x1024."
  // and a description with no trailing period both behave. Non-greedy: first match wins.
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(description);
  const sentence = (match ? match[0] : description).trim();

  return truncate(sentence || bookTitle.trim(), MAX_ALT_CHARS);
}

/** Word-boundary truncation. The ellipsis counts toward `max`, so the cap is a real cap. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const lastSpace = head.lastIndexOf(' ');
  return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

/**
 * Reads `HERO_POOL_WHERE`, keeps only pages whose derived 960 artifact exists on disk,
 * applies both caps, and returns wire-ready frames.
 *
 * Deterministic ordering — book `created_at` ascending, then `page_number` ascending — so
 * the response is stable enough to carry `Cache-Control: public, max-age=300`. Variety
 * comes from the *client* picking a random start index at mount, which gets it without
 * defeating an HTTP cache. `id` is a secondary sort only to break a `created_at` tie,
 * which SQLite's millisecond resolution makes reachable for rows written in one seed run.
 */
export async function resolveHeroPool(): Promise<HeroFrame[]> {
  const books = await prisma.book.findMany({
    where: HERO_POOL_WHERE,
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    include: { pages: { orderBy: { page_number: 'asc' } } },
  });

  const frames: HeroFrame[] = [];

  for (const book of books) {
    let takenFromBook = 0;

    for (const page of book.pages) {
      if (frames.length >= MAX_POOL_FRAMES) return frames;
      if (takenFromBook >= MAX_FRAMES_PER_BOOK) break;
      if (!heroFrameExists(book.id, page.page_number)) continue;

      frames.push({
        id: `${book.id}-p${page.page_number}`,
        // The consent seam's third mechanism. A personal frame carries 'personal' and
        // cannot validate against HeroPoolResponseSchema — see shared/src/hero.ts.
        source: 'pool',
        src: frameUrl(book.id, page.page_number, 960),
        src_small: frameUrl(book.id, page.page_number, 480),
        width: HERO_FRAME_WIDTH,
        height: HERO_FRAME_HEIGHT,
        alt: deriveAlt(page.illustration_description, book.title),
        book_id: book.id,
        book_title: book.title,
      });
      takenFromBook += 1;
    }
  }

  return frames;
}
