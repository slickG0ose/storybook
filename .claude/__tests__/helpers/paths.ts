import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const CLAUDE_DIR = path.join(REPO_ROOT, '.claude');

export const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');
export const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
export const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
export const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
export const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');

function listMd(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f));
}

export function agentFiles(): string[] {
  return listMd(AGENTS_DIR);
}

export function commandFiles(): string[] {
  return listMd(COMMANDS_DIR);
}

export function skillFiles(): string[] {
  return readdirSync(SKILLS_DIR)
    .map((name) => path.join(SKILLS_DIR, name, 'SKILL.md'))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

export function hookScripts(): string[] {
  return readdirSync(HOOKS_DIR)
    .filter((f) => f.endsWith('.sh'))
    .map((f) => path.join(HOOKS_DIR, f));
}
