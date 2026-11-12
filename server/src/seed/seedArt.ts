import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import {
  buildCoverPrompt,
  buildIllustrationPrompt,
  buildPortraitPrompt,
  collectRequiredPortraitRefs,
  composeReferenceImages,
} from '../services/illustrations';
import { costCentsFor } from '../services/spend';
import { ILLUSTRATIONS_DIR } from '../services/storage';
import {
  SEED_ART_FORMAT,
  SEED_ART_PIN,
  type CanonicalBook,
  type SeedBookId,
} from './canonicalBooks';

// Offline planner + runner for the seed-book art (spec: seed-book-illustrations
// Task 4). Pure planning, injected generator and converter, no DB. The CLI in
// scripts/generate-seed-art.ts wires the real provider and `sips`.

export type SeedArtSlot =
  | { kind: 'portrait'; characterIndex: number }
  | { kind: 'cover' }
  | { kind: 'page'; page: number };

export interface SeedArtJob {
  bookId: SeedBookId;
  slot: SeedArtSlot;
  prompt: string;
  /** Web paths ('/illustrations/<id>/portrait-1000.png') handed to the generator. */
  references: string[];
}

export interface SeedArtManifestEntry {
  bookId: SeedBookId;
  slot: string;
  file: string;
  bytes: number;
  width: number;
  height: number;
  model: string;
  prompt: string;
  generatedAt: string;
}

export const SEED_ART_ABSOLUTE_MAX_IMAGES = 60;

/** Gitignored raw-PNG cache: every provider call lands here before anything else. */
export const SEED_ART_CACHE_DIR = join(import.meta.dirname, '../../.seed-art');
export const SEED_ART_MANIFEST_PATH = join(import.meta.dirname, 'seed-art-manifest.json');

export interface SeedArtDirs {
  cacheDir?: string;
  publicDir?: string;
}

/** 'portrait-1000' | 'cover' | 'page-3' */
export function slotName(slot: SeedArtSlot): string {
  if (slot.kind === 'cover') return 'cover';
  if (slot.kind === 'page') return `page-${slot.page}`;
  return `portrait-${1000 + slot.characterIndex}`;
}

export function cachePngPath(bookId: string, slot: SeedArtSlot, cacheDir = SEED_ART_CACHE_DIR): string {
  return join(cacheDir, bookId, `${slotName(slot)}.png`);
}

export function committedJpegPath(bookId: string, slot: SeedArtSlot, publicDir = ILLUSTRATIONS_DIR): string {
  return join(publicDir, bookId, `${slotName(slot)}.${SEED_ART_FORMAT}`);
}

/** Where a portrait is staged as a PNG so the Fal reference resolver can read it. */
export function stagedPortraitPath(bookId: string, characterIndex: number, publicDir = ILLUSTRATIONS_DIR): string {
  return join(publicDir, bookId, `portrait-${1000 + characterIndex}.png`);
}

export function stagedPortraitUrl(bookId: string, characterIndex: number): string {
  return `/illustrations/${bookId}/portrait-${1000 + characterIndex}.png`;
}

/** Model the provider will hit for a job, mirroring FalImageGenerator's branching. */
export function modelForJob(job: SeedArtJob): string {
  if (job.references.length === 0) return SEED_ART_PIN.model;
  return job.references.length === 1 ? 'fal-ai/flux-pro/kontext' : 'fal-ai/flux-pro/kontext/multi';
}

/**
 * Pure. Order per book: portraits (primary role only) -> cover -> pages 1..5.
 * Skips a slot when its raw cache PNG or committed JPEG exists, unless its
 * "<id>:<slot>" name is in `redo`.
 */
export function planSeedArt(
  books: readonly CanonicalBook[],
  exists: (absPath: string) => boolean,
  opts: { redo?: string[]; only?: SeedBookId[] } & SeedArtDirs = {},
): SeedArtJob[] {
  const redo = new Set(opts.redo ?? []);
  const jobs: SeedArtJob[] = [];

  for (const book of books) {
    if (opts.only && !opts.only.includes(book.id)) continue;

    // Staged portrait URLs only for primary characters: those are the references.
    const stagedCast = book.characters.map((c, i) =>
      c.role === 'primary' ? { ...c, portrait_url: stagedPortraitUrl(book.id, i) } : c,
    );
    const references = composeReferenceImages(null, collectRequiredPortraitRefs(stagedCast));

    const wanted: SeedArtJob[] = [];
    book.characters.forEach((c, characterIndex) => {
      if (c.role !== 'primary') return;
      wanted.push({
        bookId: book.id,
        slot: { kind: 'portrait', characterIndex },
        prompt: buildPortraitPrompt({
          name: c.name,
          descriptor: c.descriptor,
          styleDescriptor: book.style_descriptor,
        }),
        references: [],
      });
    });
    wanted.push({
      bookId: book.id,
      slot: { kind: 'cover' },
      prompt: buildCoverPrompt({
        title: book.title,
        description: book.coverScene ?? book.description,
        styleDescriptor: book.style_descriptor,
        characters: book.characters,
      }),
      references,
    });
    book.pages.forEach((p, i) => {
      wanted.push({
        bookId: book.id,
        slot: { kind: 'page', page: i + 1 },
        prompt: buildIllustrationPrompt({
          description: p.illustration_description,
          styleDescriptor: book.style_descriptor,
          characters: book.characters,
          referenceImages: references,
          styleAnchor: null,
        }),
        references,
      });
    });

    for (const job of wanted) {
      const forced = redo.has(`${job.bookId}:${slotName(job.slot)}`);
      const done =
        exists(cachePngPath(job.bookId, job.slot, opts.cacheDir)) ||
        exists(committedJpegPath(job.bookId, job.slot, opts.publicDir));
      if (forced || !done) jobs.push(job);
    }
  }
  return jobs;
}

export function planCostCents(jobs: SeedArtJob[]): number {
  return jobs.length * costCentsFor('illustration', 'fal');
}

/** Width/height from a PNG or JPEG header; 0/0 when the bytes are neither. */
export function readImageSize(buf: Buffer): { width: number; height: number } {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return { width: 0, height: 0 };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export interface SeedArtDeps extends SeedArtDirs {
  /** CLI: getImageGenerator(SEED_ART_PIN).generate(prompt, { referenceImages }). */
  generate: (prompt: string, references: string[]) => Promise<Buffer>;
  /** CLI: sips -s format jpeg -s formatOptions 82. */
  toJpeg: (pngPath: string, jpgPath: string) => Promise<void>;
  /** CLI: sips -s format png. Only needed to rebuild a missing raw portrait. */
  toPng?: (jpgPath: string, pngPath: string) => Promise<void>;
  /** Hard stop: no provider call is made once this many have been made this run. */
  maxImages: number;
  /** Called after each finished job, so a crash cannot lose manifest entries. */
  onEntry?: (entry: SeedArtManifestEntry) => void | Promise<void>;
  now?: () => Date;
}

// Make sure every reference a job names exists as a staged PNG in the public
// dir (where the local storage backend resolves it). Prefer the raw cache; fall
// back to rebuilding from the committed JPEG at no provider cost.
async function ensureStagedReferences(job: SeedArtJob, deps: SeedArtDeps, staged: Set<string>): Promise<void> {
  const publicDir = deps.publicDir ?? ILLUSTRATIONS_DIR;
  const cacheDir = deps.cacheDir ?? SEED_ART_CACHE_DIR;
  for (const ref of job.references) {
    const m = ref.match(/^\/illustrations\/([^/]+)\/portrait-(\d+)\.png$/);
    if (!m) continue;
    const slot: SeedArtSlot = { kind: 'portrait', characterIndex: Number(m[2]) - 1000 };
    const stagedPath = stagedPortraitPath(m[1], slot.characterIndex, publicDir);
    if (await fileExists(stagedPath)) continue;
    const cached = cachePngPath(m[1], slot, cacheDir);
    const committed = committedJpegPath(m[1], slot, publicDir);
    await mkdir(dirname(stagedPath), { recursive: true });
    if (await fileExists(cached)) {
      await copyFile(cached, stagedPath);
    } else if (await fileExists(committed) && deps.toPng) {
      await deps.toPng(committed, stagedPath);
      await mkdir(dirname(cached), { recursive: true });
      await copyFile(stagedPath, cached);
    } else {
      throw new Error(`Missing portrait reference ${ref}: no cached PNG and no committed JPEG to rebuild it from.`);
    }
    staged.add(stagedPath);
  }
}

/**
 * Runs the jobs in order. Every provider result is written to the raw cache
 * BEFORE any other step, so a failure later never costs a second payment.
 * Stops (without throwing) before job `maxImages + 1`.
 */
export async function runSeedArt(jobs: SeedArtJob[], deps: SeedArtDeps): Promise<SeedArtManifestEntry[]> {
  const publicDir = deps.publicDir ?? ILLUSTRATIONS_DIR;
  const cacheDir = deps.cacheDir ?? SEED_ART_CACHE_DIR;
  const now = deps.now ?? (() => new Date());
  const entries: SeedArtManifestEntry[] = [];
  const staged = new Set<string>();
  let calls = 0;

  try {
    for (const job of jobs) {
      if (calls >= deps.maxImages) break;

      await ensureStagedReferences(job, deps, staged);

      const png = await deps.generate(job.prompt, job.references);
      calls++;
      const cachePath = cachePngPath(job.bookId, job.slot, cacheDir);
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, png);

      if (job.slot.kind === 'portrait') {
        const stagedPath = stagedPortraitPath(job.bookId, job.slot.characterIndex, publicDir);
        await mkdir(dirname(stagedPath), { recursive: true });
        await copyFile(cachePath, stagedPath);
        staged.add(stagedPath);
      }

      const entry = await convertSlot(job.bookId, job.slot, deps, {
        model: modelForJob(job),
        prompt: job.prompt,
        generatedAt: now().toISOString(),
      });
      entries.push(entry);
      await deps.onEntry?.(entry);
    }
  } finally {
    for (const p of staged) await rm(p, { force: true });
  }
  return entries;
}

async function convertSlot(
  bookId: SeedBookId,
  slot: SeedArtSlot,
  deps: Pick<SeedArtDeps, 'toJpeg' | 'cacheDir' | 'publicDir'>,
  meta: { model: string; prompt: string; generatedAt: string },
): Promise<SeedArtManifestEntry> {
  const jpg = committedJpegPath(bookId, slot, deps.publicDir);
  await mkdir(dirname(jpg), { recursive: true });
  await deps.toJpeg(cachePngPath(bookId, slot, deps.cacheDir), jpg);
  const bytes = await readFile(jpg);
  return {
    bookId,
    slot: slotName(slot),
    file: `${bookId}/${slotName(slot)}.${SEED_ART_FORMAT}`,
    bytes: bytes.length,
    ...readImageSize(bytes),
    ...meta,
  };
}

/**
 * $0 path: rebuild every JPEG whose raw PNG is cached, and refresh the size
 * fields of any manifest entry that already exists for it. Returns the updated
 * entries; slots with no manifest entry are converted but not recorded (the
 * prompt that drew them is unknown).
 */
export async function compressFromCache(
  books: readonly CanonicalBook[],
  existing: SeedArtManifestEntry[],
  deps: Pick<SeedArtDeps, 'toJpeg' | 'cacheDir' | 'publicDir'>,
): Promise<{ converted: number; entries: SeedArtManifestEntry[] }> {
  const byKey = new Map(existing.map((e) => [`${e.bookId}:${e.slot}`, e]));
  let converted = 0;
  for (const book of books) {
    const slots: SeedArtSlot[] = [
      ...book.characters.flatMap((c, characterIndex): SeedArtSlot[] =>
        c.role === 'primary' ? [{ kind: 'portrait', characterIndex }] : []),
      { kind: 'cover' },
      ...book.pages.map((_, i): SeedArtSlot => ({ kind: 'page', page: i + 1 })),
    ];
    for (const slot of slots) {
      if (!(await fileExists(cachePngPath(book.id, slot, deps.cacheDir)))) continue;
      const prev = byKey.get(`${book.id}:${slotName(slot)}`);
      const entry = await convertSlot(book.id, slot, deps, {
        model: prev?.model ?? SEED_ART_PIN.model,
        prompt: prev?.prompt ?? '',
        generatedAt: prev?.generatedAt ?? new Date().toISOString(),
      });
      converted++;
      if (prev) byKey.set(`${book.id}:${slotName(slot)}`, entry);
    }
  }
  return { converted, entries: [...byKey.values()] };
}

/** Merge new entries into an existing manifest, keyed by book + slot, in a stable order. */
export function mergeManifest(existing: SeedArtManifestEntry[], fresh: SeedArtManifestEntry[]): SeedArtManifestEntry[] {
  const map = new Map(existing.map((e) => [`${e.bookId}:${e.slot}`, e]));
  for (const e of fresh) map.set(`${e.bookId}:${e.slot}`, e);
  return [...map.values()].sort((a, b) => a.file.localeCompare(b.file));
}
