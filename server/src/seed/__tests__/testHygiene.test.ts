import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { SEED_BOOK_IDS } from '../canonicalBooks';

/**
 * Seed-book directories under server/public/illustrations/<seed-id>/ hold
 * committed art fixtures. A test that writes or removes files there would delete
 * them from every working tree after a local run. Tests must use a test-only
 * book id instead.
 *
 * Static scan only: this test reads source files and writes nothing.
 */
const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

// Paths are relative to server/src, with forward slashes.
const ALLOWLIST: Record<string, string> = {
  'routes/__tests__/books.test.ts':
    'removes only the page-N.png files it wrote; cannot collide with committed .jpg fixtures',
  'routes/__tests__/admin.test.ts':
    'uses seed ids only for DB rows and routes; every directory it creates or removes is keyed to a test-only id',
};

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...testFiles(full));
    } else if (full.endsWith('.ts') && full.split(sep).includes('__tests__')) {
      out.push(full);
    }
  }
  return out;
}

export function findOffenders(
  files: { path: string; text: string }[],
  allowlist: Record<string, string>,
): string[] {
  const offenders: string[] = [];
  for (const { path, text } of files) {
    if (path in allowlist) continue;
    if (!text.includes('public/illustrations')) continue;
    const id = SEED_BOOK_IDS.find((seedId) => text.includes(seedId));
    if (id) offenders.push(`${path} mentions public/illustrations and seed book id "${id}"`);
  }
  return offenders;
}

describe('test hygiene: seed-book illustration directories', () => {
  it('no server test file touches public/illustrations with a seed-book id', () => {
    const files = testFiles(SRC_ROOT)
      .filter((f) => f !== SELF)
      .map((f) => ({
        path: relative(SRC_ROOT, f).split(sep).join('/'),
        text: readFileSync(f, 'utf8'),
      }));
    expect(files.length).toBeGreaterThan(0);
    expect(findOffenders(files, ALLOWLIST)).toEqual([]);
  });

  it('flags a file that mentions both public/illustrations and a seed id (the guard can fail)', () => {
    const bad = {
      path: 'services/__tests__/example.test.ts',
      text: "join(dir, '../../../public/illustrations', 'luna-star-garden')",
    };
    expect(findOffenders([bad], ALLOWLIST)).toHaveLength(1);
    expect(findOffenders([bad], { [bad.path]: 'allowed' })).toHaveLength(0);
  });
});
