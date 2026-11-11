import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CANONICAL_BOOKS } from '../canonicalBooks';
import {
  cachePngPath,
  committedJpegPath,
  planCostCents,
  planSeedArt,
  runSeedArt,
  stagedPortraitPath,
} from '../seedArt';

const none = () => false;
const PNG = Buffer.from('fake-png-bytes');

describe('planSeedArt', () => {
  it('plans 43 jobs from an empty disk: 7 portraits, 6 covers, 30 pages', () => {
    const jobs = planSeedArt(CANONICAL_BOOKS, none);
    expect(jobs).toHaveLength(43);
    expect(jobs.filter((j) => j.slot.kind === 'portrait')).toHaveLength(7);
    expect(jobs.filter((j) => j.slot.kind === 'cover')).toHaveLength(6);
    expect(jobs.filter((j) => j.slot.kind === 'page')).toHaveLength(30);
  });

  it('orders each book portraits, then cover, then pages 1..5', () => {
    const luna = planSeedArt(CANONICAL_BOOKS, none, { only: ['luna-star-garden'] });
    expect(luna.map((j) => j.slot.kind)).toEqual(['portrait', 'cover', 'page', 'page', 'page', 'page', 'page']);
  });

  it('gives robot pages 2 references, other pages 1, portraits 0', () => {
    const jobs = planSeedArt(CANONICAL_BOOKS, none);
    for (const j of jobs) {
      if (j.slot.kind === 'portrait') expect(j.references).toHaveLength(0);
      else if (j.slot.kind === 'page') {
        expect(j.references).toHaveLength(j.bookId === 'robot-learns-to-hug' ? 2 : 1);
      }
    }
    const robotPage = jobs.find((j) => j.bookId === 'robot-learns-to-hug' && j.slot.kind === 'page')!;
    expect(robotPage.references).toEqual([
      '/illustrations/robot-learns-to-hug/portrait-1000.png',
      '/illustrations/robot-learns-to-hug/portrait-1001.png',
    ]);
  });

  it('draws the Luna cover from coverScene, not the Storm King description', () => {
    const luna = CANONICAL_BOOKS.find((b) => b.id === 'luna-star-garden')!;
    const cover = planSeedArt(CANONICAL_BOOKS, none).find((j) => j.bookId === luna.id && j.slot.kind === 'cover')!;
    expect(cover.prompt).toContain(luna.coverScene!);
    expect(cover.prompt).not.toContain('Storm King');
  });

  it('skips a slot with a cached PNG or a committed JPEG, and redo re-adds it', () => {
    const cover = { kind: 'cover' } as const;
    const page2 = { kind: 'page', page: 2 } as const;
    const present = new Set([cachePngPath('luna-star-garden', cover), committedJpegPath('luna-star-garden', page2)]);
    const exists = (p: string) => present.has(p);

    const jobs = planSeedArt(CANONICAL_BOOKS, exists);
    expect(jobs).toHaveLength(41);

    const redone = planSeedArt(CANONICAL_BOOKS, exists, { redo: ['luna-star-garden:cover', 'luna-star-garden:page-2'] });
    expect(redone).toHaveLength(43);
  });

  it('costs 43 jobs at 172 cents', () => {
    expect(planCostCents(planSeedArt(CANONICAL_BOOKS, none))).toBe(172);
  });
});

describe('runSeedArt', () => {
  let root: string;
  let cacheDir: string;
  let publicDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seed-art-test-'));
    cacheDir = join(root, 'cache');
    publicDir = join(root, 'public');
    mkdirSync(cacheDir);
    mkdirSync(publicDir);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const toJpeg = async (_png: string, jpg: string) => writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  it('writes the raw cache before converting, and stops before job maxImages + 1', async () => {
    const jobs = planSeedArt(CANONICAL_BOOKS, none, { only: ['luna-star-garden'], cacheDir, publicDir });
    const order: string[] = [];
    let generated = 0;
    const entries = await runSeedArt(jobs, {
      cacheDir,
      publicDir,
      maxImages: 3,
      generate: async () => { generated++; order.push('generate'); return PNG; },
      toJpeg: async (png, jpg) => {
        order.push(existsSync(png) ? 'cache-present' : 'cache-MISSING');
        await toJpeg(png, jpg);
      },
    });
    expect(generated).toBe(3);
    expect(entries).toHaveLength(3);
    expect(order).toEqual(['generate', 'cache-present', 'generate', 'cache-present', 'generate', 'cache-present']);
    expect(entries[0]).toMatchObject({
      bookId: 'luna-star-garden',
      slot: 'portrait-1000',
      file: 'luna-star-garden/portrait-1000.jpg',
      model: 'fal-ai/flux-pro/v1.1',
      bytes: 4,
    });
    expect(entries[1]).toMatchObject({ slot: 'cover', model: 'fal-ai/flux-pro/kontext' });
    // The staged reference PNG is cleaned out of the public dir afterwards.
    expect(existsSync(stagedPortraitPath('luna-star-garden', 0, publicDir))).toBe(false);
    expect(existsSync(committedJpegPath('luna-star-garden', { kind: 'cover' }, publicDir))).toBe(true);
  });

  it('keeps jobs 1-2 cached when job 3 throws, and a re-plan skips them', async () => {
    const jobs = planSeedArt(CANONICAL_BOOKS, none, { only: ['luna-star-garden'], cacheDir, publicDir });
    let n = 0;
    await expect(
      runSeedArt(jobs, {
        cacheDir,
        publicDir,
        maxImages: 10,
        generate: async () => { if (++n === 3) throw new Error('provider down'); return PNG; },
        toJpeg,
      }),
    ).rejects.toThrow('provider down');

    expect(readFileSync(cachePngPath('luna-star-garden', { kind: 'portrait', characterIndex: 0 }, cacheDir))).toEqual(PNG);
    expect(existsSync(cachePngPath('luna-star-garden', { kind: 'cover' }, cacheDir))).toBe(true);
    expect(existsSync(cachePngPath('luna-star-garden', { kind: 'page', page: 1 }, cacheDir))).toBe(false);

    const replan = planSeedArt(CANONICAL_BOOKS, existsSync, { only: ['luna-star-garden'], cacheDir, publicDir });
    expect(replan).toHaveLength(5);
  });

  it('rebuilds a missing raw portrait from its committed JPEG instead of generating', async () => {
    const jobs = planSeedArt(CANONICAL_BOOKS, none, { only: ['luna-star-garden'], cacheDir, publicDir })
      .filter((j) => j.slot.kind === 'cover');
    mkdirSync(join(publicDir, 'luna-star-garden'), { recursive: true });
    writeFileSync(committedJpegPath('luna-star-garden', { kind: 'portrait', characterIndex: 0 }, publicDir), Buffer.from([0xff, 0xd8]));
    const rebuilt: string[] = [];
    await runSeedArt(jobs, {
      cacheDir,
      publicDir,
      maxImages: 1,
      generate: async () => PNG,
      toJpeg,
      toPng: async (_jpg, png) => { rebuilt.push(png); writeFileSync(png, PNG); },
    });
    expect(rebuilt).toEqual([stagedPortraitPath('luna-star-garden', 0, publicDir)]);
  });
});
