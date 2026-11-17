import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * render.yaml is the declared prod config and lives in this repo, so a drifted
 * media setting fails here, on the PR that does it (#237). Beside
 * rateLimitScope.test.ts, which reads the same file the same way.
 *
 * Reads the text, not a YAML parse: the repo has no YAML dependency and this
 * task adds none. Each env var is a `- key: NAME` block, so slice from one
 * `- key:` line to the next.
 */
const RENDER_YAML = join(import.meta.dirname, '..', '..', '..', 'render.yaml');

function envBlock(yaml: string, key: string): string | null {
  const lines = yaml.split('\n');
  const start = lines.findIndex(l => new RegExp(`^\\s*- key: ${key}\\s*$`).test(l));
  if (start === -1) return null;
  const out: string[] = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*- key:/.test(line)) break;
    if (/^\s*#/.test(line) || line.trim() === '') break; // a comment or blank starts the next entry
    out.push(line);
  }
  return out.join('\n');
}

describe('render.yaml media URL settings', () => {
  const yaml = readFileSync(RENDER_YAML, 'utf-8');

  it('generates MEDIA_URL_SECRET (generateValue: true)', () => {
    const block = envBlock(yaml, 'MEDIA_URL_SECRET');
    expect(block, 'MEDIA_URL_SECRET is not declared in render.yaml').not.toBeNull();
    expect(block).toMatch(/^\s*generateValue:\s*true\s*$/m);
  });

  it('declares MEDIA_URL_SECRET_PREVIOUS as sync: false', () => {
    expect(envBlock(yaml, 'MEDIA_URL_SECRET_PREVIOUS')).toMatch(/^\s*sync:\s*false\s*$/m);
  });

  it('declares MEDIA_URL_MODE as exactly enforce (stage 4)', () => {
    const block = envBlock(yaml, 'MEDIA_URL_MODE');
    expect(block, 'MEDIA_URL_MODE is not declared in render.yaml').not.toBeNull();
    expect(block).toMatch(/^\s*value:\s*enforce\s*$/m);
  });
});
