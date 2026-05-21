#!/usr/bin/env node
// Hydrates a new git worktree with the gitignored files it needs to run.
// Idempotent: skips files that already exist in the worktree.
//
// Run after `git worktree add ...`:
//   npm run setup:worktree
//
// Currently copies (from the main checkout):
//   .env                — root-level secrets (OPENAI_API_KEY, ANTHROPIC_API_KEY)
//   server/.env         — DATABASE_URL etc.
//   server/prisma/dev.db — local Prisma SQLite database
//
// Both .env files are needed because server/src/loadEnv.ts reads them both:
// the root file holds API keys, the server file holds DATABASE_URL.
//
// No-op when invoked from the main checkout.

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

const worktreeRoot = git('rev-parse --show-toplevel');
const mainRepoRoot = resolve(dirname(git('rev-parse --git-common-dir')));

if (worktreeRoot === mainRepoRoot) {
  console.log('[worktree-setup] Running from the main checkout — nothing to do.');
  process.exit(0);
}

const files = [
  { rel: '.env' },
  { rel: 'server/.env' },
  { rel: 'server/prisma/dev.db' },
];

let copied = 0;
let skipped = 0;
let missingSource = 0;

for (const { rel } of files) {
  const src = join(mainRepoRoot, rel);
  const dst = join(worktreeRoot, rel);
  if (existsSync(dst)) {
    console.log(`[worktree-setup] skip: ${rel} already exists in worktree`);
    skipped++;
    continue;
  }
  if (!existsSync(src)) {
    console.warn(`[worktree-setup] warn: ${rel} not found in main checkout (${src})`);
    missingSource++;
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`[worktree-setup] copied: ${rel}`);
  copied++;
}

console.log(`[worktree-setup] done — ${copied} copied, ${skipped} skipped, ${missingSource} missing in source`);
