import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import prisma from '../db/prisma';

// The single choke point for "which image model serves this book".
//
// Re-rolling a page on an old book used to silently adopt today's default
// provider, so a book drawn on gpt-image-1 in May came back as Flux Pro glossy
// digital painting in August. The fix is a per-book pin (Book.image_provider /
// Book.image_model) that wins over IMAGE_PROVIDER for any book that has art.
//
// This module deliberately does NOT import from ./illustrations — illustrations.ts
// imports ImagePin from here (Task 3), and the reverse import would be a cycle.
// The two constants it needs are duplicated below with cross-references.

export type ImageProvider = 'openai' | 'fal';

export interface ImagePin {
  provider: ImageProvider;
  model: string;
}

// PR #60 (1babb2d, merged 2026-06-05) made Fal Flux Pro 1.1 the default image
// provider. Art whose earliest timestamp precedes this was made on gpt-image-1.
// This is a heuristic over the best evidence available (the earliest *art*
// timestamp, never Book.created_at), and it is written back once so the system
// never silently re-decides.
export const PROVIDER_CUTOVER_AT = new Date('2026-06-05T00:00:00.000Z');

export const DEFAULT_MODEL: Record<ImageProvider, string> = {
  openai: 'gpt-image-1',
  fal: 'fal-ai/flux-pro/v1.1',
};

// Highest page_number that is a real page slot. Portrait rows are stored in the
// SAME IllustrationVersion table at PORTRAIT_SLOT_BASE + characterIndex
// (PORTRAIT_SLOT_BASE = 1000, see services/illustrations.ts). Inference must
// read page slots only: a portrait generated today on a legacy book must not
// drag that book's pin forward to today's provider.
const PAGE_SLOT_MAX = 999;

// Same on-disk base illustrations are written to (mirrors ILLUSTRATIONS_DIR in
// services/illustrations.ts; duplicated rather than imported to avoid a cycle).
const ILLUSTRATIONS_DIR = join(import.meta.dirname, '../../public/illustrations');

// page-<n>.png / page-<n>-v<m>.png — the same filename scheme
// listIllustrationVersions synthesizes history from for pre-table books.
const PAGE_FILE_PATTERN = /^page-\d+(?:-v\d+)?\.png$/;

function isImageProvider(value: string | null | undefined): value is ImageProvider {
  return value === 'openai' || value === 'fal';
}

/**
 * The pin a book with no art would get today: IMAGE_PROVIDER (default 'fal')
 * plus that provider's model override, falling back to DEFAULT_MODEL.
 *
 * An unrecognised IMAGE_PROVIDER value resolves to 'fal', matching
 * getImageGenerator()'s existing default-case behaviour.
 */
export function currentImagePin(): ImagePin {
  const raw = process.env.IMAGE_PROVIDER;
  const provider: ImageProvider = raw === 'openai' ? 'openai' : 'fal';
  const override = provider === 'openai'
    ? process.env.OPENAI_IMAGE_MODEL
    : process.env.FAL_IMAGE_MODEL;
  return { provider, model: override || DEFAULT_MODEL[provider] };
}

/**
 * Earliest evidence of this book's art:
 *   1. the minimum page-slot IllustrationVersion.created_at, else
 *   2. the oldest page-*.png mtime in public/illustrations/<bookId>/, else
 *   3. null — the book has no art at all.
 *
 * A missing directory (or an unreadable file) is swallowed as "no evidence"
 * rather than thrown: inference must never be the reason a re-roll fails.
 */
export async function earliestArtAt(bookId: string): Promise<Date | null> {
  const earliestRow = await prisma.illustrationVersion.findFirst({
    where: { book_id: bookId, page_number: { lte: PAGE_SLOT_MAX } },
    orderBy: { created_at: 'asc' },
    select: { created_at: true },
  });
  if (earliestRow) return earliestRow.created_at;

  // Filesystem synthesis fallback, for books generated before the
  // IllustrationVersion table existed: they have files on disk and no rows.
  const dir = join(ILLUSTRATIONS_DIR, bookId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  let oldest: Date | null = null;
  for (const file of files) {
    if (!PAGE_FILE_PATTERN.test(file)) continue;
    try {
      const s = await stat(join(dir, file));
      if (!oldest || s.mtime < oldest) oldest = s.mtime;
    } catch {
      // unreadable file — it contributes no evidence
    }
  }
  return oldest;
}

/**
 * Pure resolution — never writes.
 *
 * An explicit pin wins outright (and short-circuits before any DB or
 * filesystem read, so a pinned book costs nothing to resolve). Otherwise the
 * pin is inferred from the earliest art timestamp against PROVIDER_CUTOVER_AT,
 * and failing that from the current environment default.
 *
 * An unrecognised image_provider value in the DB falls through to inference
 * rather than throwing — a bad row must not brick the re-roll path.
 */
export async function resolveImagePin(
  book: { id: string; image_provider: string | null; image_model: string | null },
): Promise<ImagePin> {
  if (isImageProvider(book.image_provider)) {
    return {
      provider: book.image_provider,
      model: book.image_model || DEFAULT_MODEL[book.image_provider],
    };
  }

  const artAt = await earliestArtAt(book.id);
  if (!artAt) return currentImagePin();

  const provider: ImageProvider = artAt < PROVIDER_CUTOVER_AT ? 'openai' : 'fal';
  return { provider, model: DEFAULT_MODEL[provider] };
}

/**
 * Idempotent write-back. `updateMany` with `image_provider: null` in the WHERE
 * clause rather than `update` by id, so a pin written concurrently (by another
 * request that resolved first) cannot be clobbered — the second write matches
 * zero rows and no-ops.
 */
export async function ensureBookPinned(bookId: string, pin: ImagePin): Promise<void> {
  await prisma.book.updateMany({
    where: { id: bookId, image_provider: null },
    data: { image_provider: pin.provider, image_model: pin.model },
  });
}

/**
 * What routes call: resolve, then back-fill, so inference runs at most once per
 * book and the system self-heals without a migration script or a
 * filesystem-walking backfill that Prisma's SQL-only migrations cannot express.
 */
export async function resolveAndPinImagePin(
  book: { id: string; image_provider: string | null; image_model: string | null },
): Promise<ImagePin> {
  const pin = await resolveImagePin(book);
  if (!isImageProvider(book.image_provider)) {
    await ensureBookPinned(book.id, pin);
  }
  return pin;
}

/**
 * The 409 message for a book pinned to a provider this server has no key for.
 * Deliberately not a silent fallback to the configured default: that would
 * re-create the exact style-drift bug this pin exists to fix.
 */
export function pinnedProviderUnavailableError(provider: string): string {
  return `This book's illustrations were generated with ${provider}, which is not configured on this server. Re-rolling with a different provider would not match the book's existing art.`;
}
