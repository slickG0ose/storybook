import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { HOOKS_DIR, REPO_ROOT } from '../helpers/paths';
import { runHook } from '../helpers/run-hook';

const GUARD = path.join(HOOKS_DIR, 'guard-bash.sh');

// Most rules check the current git branch via $CLAUDE_PROJECT_DIR. We point
// at the real repo so rules 5 (hard reset on protected) and 7 (commit on
// protected) reflect actual project state. Where a rule's outcome depends
// on the current branch, the test description marks that.
const ENV = { CLAUDE_PROJECT_DIR: REPO_ROOT };

function expectBlock(cmd: string, reasonSubstring?: string) {
  const r = runHook(GUARD, { command: cmd }, { env: ENV });
  expect(r.exitCode, `expected block (exit 2), got ${r.exitCode}. stderr: ${r.stderr}`).toBe(2);
  if (reasonSubstring) {
    expect(r.stderr).toContain(reasonSubstring);
  }
}

function expectAllow(cmd: string) {
  const r = runHook(GUARD, { command: cmd }, { env: ENV });
  expect(r.exitCode, `expected allow (exit 0), got ${r.exitCode}. stderr: ${r.stderr}`).toBe(0);
}

describe('guard-bash.sh — rule 1: data.json deletion', () => {
  it('blocks bare `rm data.json`', () => expectBlock('rm data.json', 'data.json'));
  it('blocks `rm -f data.json`', () => expectBlock('rm -f data.json', 'data.json'));
  it('blocks `rm path/to/data.json`', () => expectBlock('rm server/data.json', 'data.json'));
  it('allows `rm foo.txt`', () => expectAllow('rm foo.txt'));
  it('allows `rm data.json.bak` (different file)', () => expectAllow('rm data.json.bak'));
});

describe('guard-bash.sh — rule 2: test file deletion', () => {
  it('blocks `rm foo.test.ts`', () => expectBlock('rm foo.test.ts', 'test file'));
  it('blocks `rm bar.spec.tsx`', () => expectBlock('rm bar.spec.tsx', 'test file'));
  it('blocks `rm path/file.test.js`', () => expectBlock('rm server/x.test.js', 'test file'));
  it('allows `rm foo.ts` (non-test)', () => expectAllow('rm foo.ts'));
});

describe('guard-bash.sh — rule 3: dev.db deletion', () => {
  it('blocks `rm dev.db`', () => expectBlock('rm dev.db', 'dev.db'));
  it('blocks `rm server/prisma/dev.db`', () => expectBlock('rm server/prisma/dev.db', 'dev.db'));
  it('allows `rm dev.db.snapshot`', () => expectAllow('rm dev.db.snapshot'));
});

describe('guard-bash.sh — rule 4: force-push to protected branch', () => {
  it('blocks `git push --force origin master`', () =>
    expectBlock('git push --force origin master', 'force-push'));
  it('blocks `git push -f origin main`', () => expectBlock('git push -f origin main', 'force-push'));
  it('blocks `git push --force-with-lease origin develop`', () =>
    expectBlock('git push --force-with-lease origin develop', 'force-push'));
  it('allows `git push --force origin feature/foo`', () =>
    expectAllow('git push --force origin feature/foo'));
  it('allows `git push origin master` (no force)', () =>
    expectAllow('git push origin master'));
});

describe('guard-bash.sh — rule 5 + 7: protected-branch operations (current branch dependent)', () => {
  // We are on a feature branch (test/hr11-...) during the test run.
  it('allows `git reset --hard` while on feature branch', () =>
    expectAllow('git reset --hard origin/master'));
  it('allows `git commit` while on feature branch', () =>
    expectAllow('git commit -m wip'));
});

describe('guard-bash.sh — rule 6: .git directory removal', () => {
  it('blocks `rm -rf .git`', () => expectBlock('rm -rf .git', '.git directory'));
  it('blocks `rm -r .git`', () => expectBlock('rm -r .git', '.git directory'));
  it('blocks `rm -rf path/.git`', () => expectBlock('rm -rf foo/.git', '.git directory'));
  it('allows `rm .gitignore`', () => expectAllow('rm .gitignore'));
  it('allows `rm -rf node_modules`', () => expectAllow('rm -rf node_modules'));
});

describe('guard-bash.sh — false-positive regressions', () => {
  it('allows heredoc body containing blocked pattern (the bug found while creating HR11)', () => {
    const cmd = `gh issue create --body "$(cat <<'EOF'\nmentions \`git reset --hard\` and rm data.json in markdown\nEOF\n)"`;
    expectAllow(cmd);
  });

  it('allows single-quoted echo containing blocked pattern', () => {
    expectAllow("echo 'do not rm data.json'");
  });

  it('allows double-quoted echo containing blocked pattern', () => {
    expectAllow('echo "do not rm -rf .git"');
  });

  it('allows test description in shell function containing blocked patterns', () => {
    const cmd = `run_test "rm of test file" "rm foo.test.ts"`;
    expectAllow(cmd);
  });
});

describe('guard-bash.sh — edge cases', () => {
  it('allows empty command', () => expectAllow(''));
  it('allows simple ls', () => expectAllow('ls -la'));
  it('allows multi-step pipeline that does not trip any rule', () =>
    expectAllow('git status | head -5'));
});
