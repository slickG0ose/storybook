---
description: Start a new task — pick a backlog item, create a properly-named branch + worktree, scaffold a scratchpad
argument-hint: [backlog-id] (optional, e.g. T2.5, OPS.1)
---

Kick off a new task following the project's branching convention in `CLAUDE.md`.

## Steps

1. **Read** `docs/backlog.md` to see what's open.

2. **Pick the item:**
   - If an argument was provided, look up that backlog ID (e.g., `T2.5`, `OPS.1`) and confirm the task with the user in one sentence.
   - Otherwise, list open items grouped by tier (skip `[x]` done ones) and ask which to start.

3. **Propose a branch name** following the convention:
   - Type prefix from `feat/ | fix/ | chore/ | docs/ | test/ | refactor/`
   - Wrap with `agent/<type>/` since this command is creating an agent-driven worktree
   - Kebab-case descriptor, short and scope-y (e.g., `agent/feat/community-creations`, `agent/chore/replace-demo-seed`)
   - Show the proposed name and the inferred type, ask the user to confirm or tweak

4. **Create the worktree** off `master` using the agreed branch name. Use the `EnterWorktree` tool. If `EnterWorktree` isn't available in this session, fall back to a plain `git worktree add` and tell the user the path.

5. **Hydrate the worktree** so it's runnable before any agent touches it. Run from the worktree root:

   ```
   npm install
   npm run setup:worktree
   ```

   The first command installs workspace deps (~30–60s, ~420 packages). The second copies gitignored files the worktree needs to run — currently `server/.env` and `server/prisma/dev.db` — from the main checkout. Both are idempotent.

   If `@prisma/client` isn't resolvable after install (corporate-cert environments can block `npx prisma generate` from fetching binaries), copy the generated client from the main checkout as a workaround:

   ```
   cp -r ../../node_modules/.prisma server/node_modules/
   cp -r ../../node_modules/@prisma server/node_modules/@prisma
   ```

   Skip this step only if the task is docs-only and explicitly doesn't need a runnable server/client.

6. **Scaffold a scratchpad** by appending to the "Working notes" section of `docs/backlog.md`:

   ```
   ### <branch-name> — <today's date>

   **Backlog:** <ID> — <one-line task summary>
   **Owner agent:** <storefront | booksmith | qa | multi-zone>

   **Plan**
   - [ ] (placeholder)
   ```

7. **Hand off:** based on the zone(s) the task touches, recommend which agent should own it per the delegation rules in `CLAUDE.md`:
   - `client/**` → `storefront`
   - `server/**` → `booksmith`
   - Cross-zone, test infra, or e2e → `qa`

   Ask the user whether to delegate now or scope further first. Do **not** start implementing — the goal of this command is setup.
