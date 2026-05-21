---
description: Run tests, lint, and type checks for the zones changed on this branch. Mid-task sanity check — no commit, no PR.
argument-hint: [--all] (optional — force all zones instead of just changed ones)
---

Mechanical sanity check for the current branch. Faster, lighter alternative to `/ship` — use mid-task when you want a "did I break anything" pass without the commit/PR ceremony.

## Steps

1. **Detect scope** (run in parallel):
   - `git diff master...HEAD --name-only` — changed files vs base
   - `git diff --name-only` — unstaged changes
   - `git diff --cached --name-only` — staged changes

   If `$ARGUMENTS` contains `--all`, skip detection and run every zone. Otherwise, build the affected-zone set from any file paths matching `client/**`, `server/**`, `e2e/**`. Cross-zone shape changes (e.g., shared API contract, `server/src/types.ts` + `client/src/types.ts` together) implicitly pull in e2e.

2. **Report what you'll run** before running anything — one line per check, so the user can interrupt if a zone is wrong.

   Example output:
   ```
   Changed zones: client, server
   Will run:
     - cd client && npm test         (Vitest + RTL)
     - cd client && npm run lint     (ESLint)
     - cd client && npm run build    (TS check via Vite)
     - cd server && npm test         (Vitest + Supertest)
     - cd server && npx tsc --noEmit (TS check)
   Skipping: e2e (no changes detected)
   ```

3. **Run checks in parallel** where the zones are independent. Within a zone, run test/lint/typecheck in parallel too — they don't depend on each other.

   | Zone | Test | Lint | Type check |
   |------|------|------|-----------|
   | client | `cd client && npm test` | `cd client && npm run lint` | `cd client && npm run build` |
   | server | `cd server && npm test` | — (no lint script) | `cd server && npx tsc --noEmit` |
   | e2e | `cd e2e && npm test` | — | — |

4. **Report results** as a compact pass/fail table. For failures, show the first 20 lines of failure output, not the whole log:

   ```
   ✓ client tests         (19 passed)
   ✓ client lint
   ✓ client build
   ✗ server tests         (32 passed, 1 failed)
     → admin.test.ts > GET /api/admin/users > returns 403 for non-admin
       AssertionError: expected 200 to equal 403
   ✓ server typecheck
   ```

5. **If everything passes:** say so in one line and stop. Do not summarize what was run, do not list what's next — the user can see the table.

6. **If anything fails:** stop after reporting. Do **not** attempt fixes — the goal of `/verify` is signal, not action. Ask the user whether to investigate, or whether they expected this failure.

## What this command does NOT do

- No commits, no pushes, no PR.
- No manual-verification reminders (that's `/ship`).
- No dark-mode parity check (that's a future `/parity-check`).
- No fixing — surfaces failures, does not act on them.
