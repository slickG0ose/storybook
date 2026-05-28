import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOOKS_DIR } from '../helpers/paths';
import { runHook } from '../helpers/run-hook';

// log-read.sh writes to "$(dirname "$0")/read.log" — so we copy the script
// into a temp dir to keep the test from polluting the real log.

describe('log-read.sh', () => {
  let workDir: string;
  let scriptCopy: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'log-read-test-'));
    scriptCopy = path.join(workDir, 'log-read.sh');
    copyFileSync(path.join(HOOKS_DIR, 'log-read.sh'), scriptCopy);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('appends a tab-delimited record with timestamp and file_path', () => {
    const r = runHook(scriptCopy, { file_path: 'C:/foo/bar.ts' });
    expect(r.exitCode).toBe(0);

    const logPath = path.join(workDir, 'read.log');
    expect(existsSync(logPath)).toBe(true);

    const log = readFileSync(logPath, 'utf8');
    const lines = log.trim().split(/\r?\n/);
    expect(lines.length).toBe(1);

    const [timestamp, pathField] = lines[0].split('\t');
    expect(timestamp, 'timestamp should be ISO-ish').toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(pathField).toBe('C:/foo/bar.ts');
  });

  it('appends across multiple invocations (preserves history)', () => {
    runHook(scriptCopy, { file_path: '/first.ts' });
    runHook(scriptCopy, { file_path: '/second.ts' });
    runHook(scriptCopy, { file_path: '/third.ts' });

    const log = readFileSync(path.join(workDir, 'read.log'), 'utf8');
    const lines = log.trim().split(/\r?\n/);
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('/first.ts');
    expect(lines[2]).toContain('/third.ts');
  });

  it('handles missing file_path gracefully (empty record, exit 0)', () => {
    const r = runHook(scriptCopy, { other_field: 'irrelevant' });
    expect(r.exitCode).toBe(0);

    const log = readFileSync(path.join(workDir, 'read.log'), 'utf8');
    // The line is `<timestamp>\t\n` — trim would strip the trailing tab,
    // so check the raw form instead.
    expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\t]*\t\r?\n$/);
  });

  it('does not crash on malformed JSON', () => {
    // Bypass runHook and pipe raw bad input — runHook always stringifies as
    // valid JSON, so we use execSync directly to inject a malformed payload.
    expect(() => {
      execSync(`bash "${scriptCopy}"`, { input: 'not json', encoding: 'utf8' });
    }).not.toThrow();
  });
});
