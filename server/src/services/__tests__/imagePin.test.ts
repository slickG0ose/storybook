import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, writeFile, utimes } from 'fs/promises';
import { join } from 'path';
import prisma from '../../db/prisma';
import { resetDatabase } from '../../__tests__/setup';
import {
  PROVIDER_CUTOVER_AT,
  DEFAULT_MODEL,
  currentImagePin,
  earliestArtAt,
  resolveImagePin,
  ensureBookPinned,
  resolveAndPinImagePin,
  pinnedProviderUnavailableError,
} from '../imagePin';

// A dedicated book so the filesystem branch can write into its own
// public/illustrations/<id>/ directory without colliding with the seeded books
// the other service tests use.
const BOOK_ID = 'imagepin-test-book';
const BOOK_DIR = join(import.meta.dirname, '../../../public/illustrations', BOOK_ID);

// A 1x1 transparent PNG — minimal valid bytes; only the mtime is asserted on.
const FAKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const BEFORE_CUTOVER = new Date('2026-05-19T10:00:00.000Z');
const AFTER_CUTOVER = new Date('2026-07-01T10:00:00.000Z');

// Insert a real IllustrationVersion row at an explicit created_at. `version`
// participates in @@unique([book_id, page_number, version]) so each helper call
// needs its own (page, version) pair.
async function addVersionRow(pageNumber: number, version: number, createdAt: Date) {
  await prisma.illustrationVersion.create({
    data: {
      book_id: BOOK_ID,
      page_number: pageNumber,
      version,
      url: `/illustrations/${BOOK_ID}/page-${pageNumber}.png`,
      created_at: createdAt,
    },
  });
}

async function writePageFile(filename: string, mtime: Date) {
  await mkdir(BOOK_DIR, { recursive: true });
  const path = join(BOOK_DIR, filename);
  await writeFile(path, FAKE_PNG);
  await utimes(path, mtime, mtime);
}

// The unpinned book shape resolveImagePin takes.
const unpinned = { id: BOOK_ID, image_provider: null, image_model: null };

describe('imagePin service', () => {
  let originalProvider: string | undefined;
  let originalOpenAiModel: string | undefined;
  let originalFalModel: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
    originalProvider = process.env.IMAGE_PROVIDER;
    originalOpenAiModel = process.env.OPENAI_IMAGE_MODEL;
    originalFalModel = process.env.FAL_IMAGE_MODEL;
    // The production default. Tests that care about the env default set it
    // explicitly; everything else asserts the pin beats it.
    process.env.IMAGE_PROVIDER = 'fal';
    delete process.env.OPENAI_IMAGE_MODEL;
    delete process.env.FAL_IMAGE_MODEL;

    await rm(BOOK_DIR, { recursive: true, force: true });
    await prisma.book.create({
      data: {
        id: BOOK_ID,
        title: 'Pin Test Book',
        author: 'Test',
        description: 'A book for pin inference tests.',
        theme: 'test',
        age_range: '4-7',
        cover_emoji: '\u{1F4CC}',
        cover_color: '#000000',
        price: 9.99,
      },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(BOOK_DIR, { recursive: true, force: true });
    for (const [key, value] of [
      ['IMAGE_PROVIDER', originalProvider],
      ['OPENAI_IMAGE_MODEL', originalOpenAiModel],
      ['FAL_IMAGE_MODEL', originalFalModel],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('currentImagePin', () => {
    it('defaults to fal + flux-pro v1.1 when IMAGE_PROVIDER is unset', () => {
      delete process.env.IMAGE_PROVIDER;
      expect(currentImagePin()).toEqual({ provider: 'fal', model: 'fal-ai/flux-pro/v1.1' });
    });

    it('honours IMAGE_PROVIDER=openai and the per-provider model override', () => {
      process.env.IMAGE_PROVIDER = 'openai';
      process.env.OPENAI_IMAGE_MODEL = 'gpt-image-9';
      expect(currentImagePin()).toEqual({ provider: 'openai', model: 'gpt-image-9' });
    });

    it('falls back to fal for an unrecognised IMAGE_PROVIDER value', () => {
      process.env.IMAGE_PROVIDER = 'midjourney';
      expect(currentImagePin()).toEqual({ provider: 'fal', model: DEFAULT_MODEL.fal });
    });
  });

  describe('resolveImagePin — explicit pin', () => {
    it('lets an explicit openai pin win over IMAGE_PROVIDER=fal', async () => {
      const pin = await resolveImagePin({
        id: BOOK_ID,
        image_provider: 'openai',
        image_model: 'gpt-image-1',
      });
      expect(pin).toEqual({ provider: 'openai', model: 'gpt-image-1' });
    });

    it('falls back to DEFAULT_MODEL when the pinned model is null', async () => {
      const pin = await resolveImagePin({
        id: BOOK_ID,
        image_provider: 'openai',
        image_model: null,
      });
      expect(pin).toEqual({ provider: 'openai', model: DEFAULT_MODEL.openai });
    });

    it('does not run inference at all when the book is already pinned', async () => {
      // Pre-cutover page art that WOULD infer openai, plus an explicit fal pin.
      await addVersionRow(1, 1, BEFORE_CUTOVER);
      const findFirst = vi.spyOn(prisma.illustrationVersion, 'findFirst');

      const pin = await resolveImagePin({
        id: BOOK_ID,
        image_provider: 'fal',
        image_model: 'fal-ai/flux-pro/v1.1',
      });

      expect(pin).toEqual({ provider: 'fal', model: 'fal-ai/flux-pro/v1.1' });
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('falls through to inference for an unrecognised stored provider', async () => {
      await addVersionRow(1, 1, BEFORE_CUTOVER);
      const pin = await resolveImagePin({
        id: BOOK_ID,
        image_provider: 'stable-diffusion',
        image_model: 'sd-3',
      });
      expect(pin).toEqual({ provider: 'openai', model: DEFAULT_MODEL.openai });
    });
  });

  describe('resolveImagePin — inference from IllustrationVersion rows', () => {
    it('infers openai/gpt-image-1 from a page-slot row dated before the cutover', async () => {
      await addVersionRow(4, 1, BEFORE_CUTOVER);
      expect(await resolveImagePin(unpinned)).toEqual({
        provider: 'openai',
        model: 'gpt-image-1',
      });
    });

    it('infers fal/flux-pro v1.1 from a page-slot row dated after the cutover', async () => {
      await addVersionRow(4, 1, AFTER_CUTOVER);
      expect(await resolveImagePin(unpinned)).toEqual({
        provider: 'fal',
        model: 'fal-ai/flux-pro/v1.1',
      });
    });

    it('uses the EARLIEST page-slot row, not the latest', async () => {
      await addVersionRow(4, 2, AFTER_CUTOVER);
      await addVersionRow(4, 1, BEFORE_CUTOVER);
      expect((await resolveImagePin(unpinned)).provider).toBe('openai');
    });

    it('ignores portrait slots (>= 1000) so a new portrait cannot drag the pin forward', async () => {
      // A legacy book with NO page rows, whose only art row is a portrait
      // generated today. Portraits must not seed the inference — and because
      // this portrait predates the cutover, a leak would show up as 'openai'.
      await addVersionRow(1000, 1, BEFORE_CUTOVER);
      expect(await resolveImagePin(unpinned)).toEqual(currentImagePin());
      expect((await resolveImagePin(unpinned)).provider).toBe('fal');
    });

    it('prefers the DB row over an on-disk mtime', async () => {
      await addVersionRow(1, 1, AFTER_CUTOVER);
      await writePageFile('page-1.png', BEFORE_CUTOVER);
      expect((await resolveImagePin(unpinned)).provider).toBe('fal');
    });
  });

  describe('resolveImagePin — inference from file mtimes', () => {
    it('infers openai from a pre-cutover page-1.png when there are no rows', async () => {
      await writePageFile('page-1.png', BEFORE_CUTOVER);
      expect(await resolveImagePin(unpinned)).toEqual({
        provider: 'openai',
        model: 'gpt-image-1',
      });
    });

    it('infers fal from a post-cutover page file', async () => {
      await writePageFile('page-1.png', AFTER_CUTOVER);
      expect((await resolveImagePin(unpinned)).provider).toBe('fal');
    });

    it('uses the oldest page file and ignores non-page files', async () => {
      await writePageFile('page-2-v3.png', AFTER_CUTOVER);
      await writePageFile('page-1.png', BEFORE_CUTOVER);
      await writePageFile('cover.png', new Date('2020-01-01T00:00:00.000Z'));
      await writePageFile('portrait-1000.png', new Date('2020-01-01T00:00:00.000Z'));
      expect((await earliestArtAt(BOOK_ID))?.toISOString()).toBe(BEFORE_CUTOVER.toISOString());
      expect((await resolveImagePin(unpinned)).provider).toBe('openai');
    });
  });

  describe('resolveImagePin — no art at all', () => {
    it('resolves to the current environment default', async () => {
      expect(await earliestArtAt(BOOK_ID)).toBeNull();
      expect(await resolveImagePin(unpinned)).toEqual({
        provider: 'fal',
        model: 'fal-ai/flux-pro/v1.1',
      });
    });

    it('follows IMAGE_PROVIDER when it is flipped to openai', async () => {
      process.env.IMAGE_PROVIDER = 'openai';
      expect(await resolveImagePin(unpinned)).toEqual({
        provider: 'openai',
        model: 'gpt-image-1',
      });
    });
  });

  describe('write-back', () => {
    it('resolveAndPinImagePin persists the inferred pin onto the Book row', async () => {
      await addVersionRow(1, 1, BEFORE_CUTOVER);

      const pin = await resolveAndPinImagePin(unpinned);
      expect(pin).toEqual({ provider: 'openai', model: 'gpt-image-1' });

      const row = await prisma.book.findUnique({ where: { id: BOOK_ID } });
      expect(row).toMatchObject({
        image_provider: 'openai',
        image_model: 'gpt-image-1',
      });
    });

    it('calling it twice does not change an already-set pin', async () => {
      await addVersionRow(1, 1, BEFORE_CUTOVER);
      await resolveAndPinImagePin(unpinned);

      // Second call reads the now-pinned row — inference must not re-run and
      // the stored pin must survive even though the env default is fal.
      const stored = await prisma.book.findUniqueOrThrow({ where: { id: BOOK_ID } });
      const findFirst = vi.spyOn(prisma.illustrationVersion, 'findFirst');
      const pin = await resolveAndPinImagePin(stored);

      expect(pin).toEqual({ provider: 'openai', model: 'gpt-image-1' });
      expect(findFirst).not.toHaveBeenCalled();
      const after = await prisma.book.findUnique({ where: { id: BOOK_ID } });
      expect(after?.image_provider).toBe('openai');
      expect(after?.image_model).toBe('gpt-image-1');
    });

    it('ensureBookPinned cannot clobber a pin written concurrently', async () => {
      // Simulate the concurrent writer landing first.
      await prisma.book.update({
        where: { id: BOOK_ID },
        data: { image_provider: 'openai', image_model: 'gpt-image-1' },
      });

      await ensureBookPinned(BOOK_ID, { provider: 'fal', model: 'fal-ai/flux-pro/v1.1' });

      const row = await prisma.book.findUnique({ where: { id: BOOK_ID } });
      expect(row?.image_provider).toBe('openai');
      expect(row?.image_model).toBe('gpt-image-1');
    });

    it('pins an art-less book to the current environment default', async () => {
      await resolveAndPinImagePin(unpinned);
      const row = await prisma.book.findUnique({ where: { id: BOOK_ID } });
      expect(row?.image_provider).toBe('fal');
      expect(row?.image_model).toBe('fal-ai/flux-pro/v1.1');
    });
  });

  describe('constants and messages', () => {
    it('pins the cutover to the #60 merge date', () => {
      expect(PROVIDER_CUTOVER_AT.toISOString()).toBe('2026-06-05T00:00:00.000Z');
    });

    it('names the provider in the unavailable-provider message', () => {
      expect(pinnedProviderUnavailableError('openai')).toContain('openai');
    });
  });
});
