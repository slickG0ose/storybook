import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { ILLUSTRATIONS_DIR } from '../../services/storage';
import {
  CANONICAL_BOOKS, SEED_BOOK_IDS, seedCoverUrl, seedPageUrl, seedPortraitUrl,
} from '../canonicalBooks';
import manifest from '../seed-art-manifest.json';

// Budgets from Task 5's measured totals (15,645,515 bytes total, largest 576,011),
// as ruled by the owner when accepting the art.
const MAX_SINGLE_BYTES = 600 * 1024;
const MAX_TOTAL_BYTES = 17 * 1024 * 1024;

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** Every web path the seed writes: 6 covers, 30 pages, 7 portraits. */
function seededUrls(): string[] {
  const urls: string[] = [];
  for (const book of CANONICAL_BOOKS) {
    urls.push(seedCoverUrl(book.id));
    book.pages.forEach((_, i) => urls.push(seedPageUrl(book.id, i + 1)));
    book.characters.forEach((c, i) => {
      if (c.role === 'primary') urls.push(seedPortraitUrl(book.id, i));
    });
  }
  return urls;
}

const toPath = (url: string) => join(ILLUSTRATIONS_DIR, url.replace(/^\/illustrations\//, ''));

describe('committed seed-book art', () => {
  const urls = seededUrls();

  it('the seed references 43 files, each present and starting with JPEG magic bytes', () => {
    expect(urls).toHaveLength(43);
    for (const url of urls) {
      const path = toPath(url);
      expect(existsSync(path), url).toBe(true);
      const fd = openSync(path, 'r');
      const head = Buffer.alloc(3);
      readSync(fd, head, 0, 3, 0);
      closeSync(fd);
      expect([...head], url).toEqual([0xff, 0xd8, 0xff]);
    }
  });

  it('stays inside the byte budgets', () => {
    let total = 0;
    for (const url of urls) {
      const size = statSync(toPath(url)).size;
      expect(size, url).toBeLessThanOrEqual(MAX_SINGLE_BYTES);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('each seed directory holds only referenced files (no PNGs, no strays)', () => {
    const referenced = new Set(urls.map(toPath));
    for (const id of SEED_BOOK_IDS) {
      const dir = join(ILLUSTRATIONS_DIR, id);
      for (const name of readdirSync(dir)) {
        expect(referenced.has(join(dir, name)), `${id}/${name}`).toBe(true);
      }
    }
  });

  it('both .gitignore files re-include every seed book directory', () => {
    const read = (p: string) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim());
    const root = read(join(REPO_ROOT, '.gitignore'));
    // server/.gitignore re-ignores public/illustrations/*, so it needs its own re-includes.
    const nested = read(join(REPO_ROOT, 'server/.gitignore'));
    for (const id of SEED_BOOK_IDS) {
      expect(root, id).toContain(`!server/public/illustrations/${id}/`);
      expect(nested, id).toContain(`!public/illustrations/${id}/`);
    }
  });

  it('the manifest has one entry per committed file, all from fal-ai/ models', () => {
    const files = manifest.map((e) => e.file).sort();
    const expected = urls.map((u) => u.replace(/^\/illustrations\//, '')).sort();
    expect(files).toEqual(expected);
    for (const entry of manifest) expect(entry.model.startsWith('fal-ai/'), entry.file).toBe(true);
  });
});
