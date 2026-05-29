import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/paths';

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'audit-resolution.mjs');
const SNAPSHOT_PATH = path.join(
  REPO_ROOT,
  'docs',
  'conventions',
  'harness-resolution.md',
);

/**
 * The harness-resolution snapshot is a committed artifact derived from the
 * .claude/ tree. It MUST stay in sync with whatever scripts/audit-resolution.mjs
 * would produce right now — otherwise the snapshot is misleading documentation
 * and the regression gate is meaningless.
 *
 * This test re-derives the snapshot via the audit script and compares to the
 * committed file. If they drift, the test fails locally — so `npm test`
 * catches the staleness before push, instead of CI catching it after.
 *
 * To fix a failure: run `npm run audit:resolution` and commit the diff.
 *
 * Why subprocess instead of static/dynamic import? Vitest 4's transformer
 * rejects .mjs imports from .ts test files with "SyntaxError: Invalid or
 * unexpected token" before any user code runs. Calling the script via
 * `node ... --print` sidesteps the transformer entirely.
 */
describe('docs/conventions/harness-resolution.md (resolution snapshot)', () => {
  it('matches what scripts/audit-resolution.mjs would produce now', () => {
    const committed = readFileSync(SNAPSHOT_PATH, 'utf8');
    const fresh = execFileSync('node', [SCRIPT, '--print'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });

    if (committed === fresh) {
      expect(committed).toBe(fresh); // pass
      return;
    }

    throw new Error(
      'docs/conventions/harness-resolution.md is stale.\n\n' +
      `Run \`npm run audit:resolution\` and commit the updated file.\n\n` +
      'Most common cause: an agent / command / skill / hook / settings entry ' +
      'was added, removed, renamed, or had its description changed without ' +
      'regenerating the snapshot.\n\n' +
      `Expected (committed):\n${committed.slice(0, 500)}${committed.length > 500 ? '\n…(truncated)' : ''}\n\n` +
      `Actual (fresh regen):\n${fresh.slice(0, 500)}${fresh.length > 500 ? '\n…(truncated)' : ''}`,
    );
  });
});
