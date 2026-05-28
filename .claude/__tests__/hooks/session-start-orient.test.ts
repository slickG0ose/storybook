import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { HOOKS_DIR, REPO_ROOT } from '../helpers/paths';
import { runHook } from '../helpers/run-hook';

const SCRIPT = path.join(HOOKS_DIR, 'session-start-orient.sh');
const ENV = { CLAUDE_PROJECT_DIR: REPO_ROOT };

describe('session-start-orient.sh', () => {
  it('emits a Session orientation block on stdout for non-compact source', () => {
    const r = runHook(SCRIPT, {}, { source: 'startup', env: ENV });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('## Session orientation');
    expect(r.stdout).toContain('**Branch:**');
  });

  it('includes recent commits when on a git branch', () => {
    const r = runHook(SCRIPT, {}, { source: 'startup', env: ENV });
    expect(r.stdout).toContain('**Recent commits:**');
  });

  it('mentions the source line at the bottom', () => {
    const r = runHook(SCRIPT, {}, { source: 'startup', env: ENV });
    expect(r.stdout).toContain('_Source: `startup`');
  });

  it('emits nothing for source=compact (skips post-compaction restarts)', () => {
    const r = runHook(SCRIPT, {}, { source: 'compact', env: ENV });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('survives missing CLAUDE_PROJECT_DIR by exiting 0 silently', () => {
    // Without CLAUDE_PROJECT_DIR set and no fallback git repo, script should exit 0 (best-effort).
    const r = runHook(SCRIPT, {}, { source: 'startup', env: { CLAUDE_PROJECT_DIR: '/nonexistent/dir' } });
    expect(r.exitCode).toBe(0);
  });
});
