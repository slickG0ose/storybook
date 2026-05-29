import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — .mjs file, not declared in any tsconfig but resolves at runtime
import { generateSnapshot, SNAPSHOT_PATH } from '../../../scripts/audit-resolution.mjs';

/**
 * The harness-resolution snapshot is a committed artifact derived from the
 * .claude/ tree. It MUST stay in sync with whatever scripts/audit-resolution.mjs
 * would produce right now — otherwise the snapshot is misleading documentation,
 * and CI fails on the `git diff --exit-code` step.
 *
 * This test re-derives the snapshot in memory (no disk writes) and compares
 * to the committed file. If they drift, the test fails locally — which means
 * `npm test` catches the staleness before push, instead of CI catching it
 * after.
 *
 * To fix a failure: run `npm run audit:resolution` and commit the diff.
 */
describe('docs/conventions/harness-resolution.md (resolution snapshot)', () => {
  it('matches what scripts/audit-resolution.mjs would produce now', () => {
    const committed = readFileSync(SNAPSHOT_PATH, 'utf8');
    const fresh = generateSnapshot();

    if (committed === fresh) {
      expect(committed).toBe(fresh); // pass
      return;
    }

    // Drift detected. Make the failure as actionable as possible — the
    // failure surface for a snapshot mismatch is dense markdown, and the
    // default vitest diff truncates long strings. So we emit a clear
    // instruction in the assertion message and let the diff render below.
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
