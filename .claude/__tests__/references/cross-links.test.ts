import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  AGENTS_DIR,
  COMMANDS_DIR,
  HOOKS_DIR,
  SETTINGS_PATH,
  hookScripts,
  agentFiles,
  commandFiles,
} from '../helpers/paths';

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function existingAgentNames(): Set<string> {
  return new Set(agentFiles().map((f) => path.basename(f, '.md')));
}

function existingCommandNames(): Set<string> {
  return new Set(commandFiles().map((f) => path.basename(f, '.md')));
}

describe('CLAUDE.md → .claude/agents/ references', () => {
  const claudeMd = read(path.join(REPO_ROOT, 'CLAUDE.md'));
  const agents = existingAgentNames();

  it('every @<agent> mention in CLAUDE.md resolves to an existing agent file', () => {
    // Pattern: **@booksmith**, @qa, @storefront, etc. Plain @mentions.
    // Negative lookahead on "/" excludes npm scoped packages (`@storybook/shared`,
    // `@anthropic-ai/sdk`), which are package references, not agent mentions.
    const matches = claudeMd.matchAll(/(?<!\w)@([a-z][a-z0-9-]+)\b(?!\/)/g);
    const referenced = new Set<string>();
    for (const m of matches) referenced.add(m[1]);

    for (const name of referenced) {
      expect(agents.has(name), `CLAUDE.md references @${name} but .claude/agents/${name}.md does not exist`).toBe(true);
    }
  });

  it('every .claude/agents/<name>.md path mention in CLAUDE.md resolves to an existing file', () => {
    const matches = claudeMd.matchAll(/\.claude\/agents\/([a-z][a-z0-9-]+)\.md/g);
    for (const m of matches) {
      expect(agents.has(m[1]), `CLAUDE.md references .claude/agents/${m[1]}.md but it does not exist`).toBe(true);
    }
  });
});

describe('CLAUDE.md → .claude/commands/ references', () => {
  const claudeMd = read(path.join(REPO_ROOT, 'CLAUDE.md'));
  const commands = existingCommandNames();

  it('every /<command> mention in CLAUDE.md resolves to an existing command file (or is a known exemption)', () => {
    // Known exemptions: commands we describe but haven't installed (future work, upstream-only).
    // Update as the harness rebuild progresses.
    const exemptions = new Set<string>([
      'create-spec',     // upstream code-captain, mentioned but not yet installed
      'execute-task',    // upstream code-captain, HR7
      'parity-check',    // hypothetical future command per /verify
    ]);

    // Pattern: backtick-wrapped `/command-name`
    const matches = claudeMd.matchAll(/`\/([a-z][a-z0-9-]+)`/g);
    const referenced = new Set<string>();
    for (const m of matches) referenced.add(m[1]);

    for (const name of referenced) {
      if (exemptions.has(name)) continue;
      expect(commands.has(name), `CLAUDE.md references /${name} but .claude/commands/${name}.md does not exist`).toBe(true);
    }
  });
});

describe('.claude/settings.json ↔ .claude/hooks/ symmetry', () => {
  type HookEntry = { type: string; command: string };
  type HookSlot = { matcher?: string; hooks: HookEntry[] };
  type Settings = { hooks?: Record<string, HookSlot[]> };

  const settings = JSON.parse(read(SETTINGS_PATH)) as Settings;

  function wiredScripts(): Set<string> {
    const set = new Set<string>();
    for (const slots of Object.values(settings.hooks ?? {})) {
      for (const slot of slots) {
        for (const h of slot.hooks) {
          const scriptPath = h.command.split(/\s/)[0];
          set.add(path.basename(scriptPath));
        }
      }
    }
    return set;
  }

  it('every script in .claude/hooks/ is wired in settings.json (no orphan hooks)', () => {
    const wired = wiredScripts();
    for (const script of hookScripts()) {
      const name = path.basename(script);
      expect(wired.has(name), `Hook script ${name} exists in .claude/hooks/ but isn't wired in settings.json — orphan`).toBe(true);
    }
  });
});

describe('.code-captain/product/decisions.md — relative markdown links', () => {
  const decisionsPath = path.join(REPO_ROOT, '.code-captain', 'product', 'decisions.md');
  const decisionsDir = path.dirname(decisionsPath);
  const body = read(decisionsPath);

  it('every relative [text](path) link resolves to an existing file', () => {
    // Match [text](path) where path is relative (no http(s)://, no #fragment-only)
    const matches = body.matchAll(/\[[^\]]+\]\(([^)#][^)]*)\)/g);
    for (const m of matches) {
      const target = m[1];
      if (/^https?:\/\//.test(target)) continue;
      if (target.startsWith('#')) continue;

      // Strip any trailing #fragment
      const cleanTarget = target.split('#')[0];
      if (!cleanTarget) continue;

      const absolute = path.isAbsolute(cleanTarget)
        ? cleanTarget
        : path.join(decisionsDir, cleanTarget);

      expect(existsSync(absolute), `decisions.md links to "${target}" but it does not exist (resolved as ${absolute})`).toBe(true);
    }
  });
});

describe('.claude/hooks/ scripts are executable', () => {
  it.each(hookScripts())('%s is marked executable', (script) => {
    // On Windows, file mode may not be meaningful — but the file should be readable.
    expect(existsSync(script)).toBe(true);
    const content = read(script);
    expect(content.startsWith('#!'), `${script}: missing shebang`).toBe(true);
  });
});
