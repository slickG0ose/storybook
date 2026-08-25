import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/paths';

/**
 * Every hook script referenced by settings.json must be executable *in git*.
 *
 * Why this test exists, and why it checks git rather than the filesystem:
 *
 * settings.json invokes hooks by bare path (`.claude/hooks/guard-bash.sh`),
 * so the OS needs the exec bit or the hook dies with "Permission denied" —
 * and a PreToolUse hook that fails to start is non-blocking, so the guard is
 * silently skipped. All three hooks shipped at mode 100644 and had therefore
 * never run for anyone; only GitHub branch protection was stopping commits on
 * master. See the sibling guard-bash.test.ts suite, which passed the whole
 * time: its runHook helper spawns `bash <script>` explicitly (deliberate, for
 * Git Bash on Windows), and shelling out that way ignores the exec bit
 * entirely. So the behavior tests cannot catch this class of bug — hence a
 * separate mode assertion.
 *
 * It reads `git ls-files -s` rather than fs.statSync because the git index
 * mode is what a fresh clone gets. A Windows checkout won't report a
 * meaningful filesystem mode, but the index mode is identical everywhere.
 */

function gitFileMode(relPath: string): string {
  const out = execFileSync('git', ['ls-files', '-s', '--', relPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  if (!out) throw new Error(`${relPath} is not tracked by git`);
  return out.split(/\s+/)[0];
}

/** Hook commands in settings.json may carry redirects (`... 2>/dev/null || true`). */
function hookScriptPaths(): string[] {
  const settings = JSON.parse(
    readFileSync(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8'),
  ) as { hooks?: Record<string, { hooks?: { command?: string }[] }[]> };

  const found = new Set<string>();
  for (const matchers of Object.values(settings.hooks ?? {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks ?? []) {
        const first = (hook.command ?? '').trim().split(/\s+/)[0];
        if (first.startsWith('.claude/hooks/')) found.add(first);
      }
    }
  }
  return [...found].sort();
}

describe('hook scripts are executable in git', () => {
  const scripts = hookScriptPaths();

  it('finds at least one hook script in settings.json', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)('%s is mode 100755', script => {
    expect(
      gitFileMode(script),
      `${script} is not executable in git. settings.json runs it by bare path, ` +
        `so a non-executable mode makes the hook fail with "Permission denied" ` +
        `and be silently skipped. Fix: git update-index --chmod=+x ${script}`,
    ).toBe('100755');
  });
});
