import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, REPO_ROOT, SETTINGS_PATH } from '../helpers/paths';

type HookEntry = { type: string; command: string };
type HookSlot = { matcher?: string; hooks: HookEntry[] };
type Settings = {
  permissions?: { allow?: string[]; defaultMode?: string };
  hooks?: Record<string, HookSlot[]>;
  enabledPlugins?: Record<string, boolean>;
};

function loadSettings(): Settings {
  const raw = readFileSync(SETTINGS_PATH, 'utf8');
  return JSON.parse(raw) as Settings;
}

describe('.claude/settings.json — shape', () => {
  it('is valid JSON', () => {
    expect(() => loadSettings()).not.toThrow();
  });

  it('declares permissions.allow as an array of strings', () => {
    const s = loadSettings();
    expect(Array.isArray(s.permissions?.allow), 'permissions.allow must be an array').toBe(true);
    for (const entry of s.permissions!.allow!) {
      expect(typeof entry, 'each allow entry must be a string').toBe('string');
      // Shape examples: Bash(*), Read(*), PowerShell(*)
      expect(entry, `malformed permission entry: ${entry}`).toMatch(/^[A-Z][A-Za-z]+\(.*\)$/);
    }
  });

  it('declares only known hook event names', () => {
    const s = loadSettings();
    const known = new Set([
      'PreToolUse',
      'PostToolUse',
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'Stop',
    ]);
    for (const event of Object.keys(s.hooks ?? {})) {
      expect(known.has(event), `unknown hook event: ${event}`).toBe(true);
    }
  });

  it('every hook command path resolves to an existing file', () => {
    const s = loadSettings();
    const events = s.hooks ?? {};
    for (const [event, slots] of Object.entries(events)) {
      for (const slot of slots) {
        for (const hook of slot.hooks) {
          // Strip shell suffixes like "2>/dev/null || true"
          const scriptPath = hook.command.split(/\s/)[0];
          // Settings.json paths are repo-relative (no leading ./).
          const absolute = path.isAbsolute(scriptPath)
            ? scriptPath
            : path.join(REPO_ROOT, scriptPath);
          expect(
            existsSync(absolute),
            `${event} hook references missing script: ${scriptPath}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('.claude/settings.local.json — when present', () => {
  const localPath = path.join(CLAUDE_DIR, 'settings.local.json');
  it.skipIf(!existsSync(localPath))('is valid JSON', () => {
    expect(() => JSON.parse(readFileSync(localPath, 'utf8'))).not.toThrow();
  });
});
