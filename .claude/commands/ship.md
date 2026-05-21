---
description: Pre-flight a branch for PR — detect changed zones, run their tests, lint, draft commit + PR
argument-hint: [pr-title] (optional — overrides auto-drafted title)
---

Get the current branch ready to ship. Follow the project's done criteria in `CLAUDE.md` strictly. Do **not** push or open a PR without explicit user confirmation.

## Steps

1. **Status check** (run in parallel):
   - `git status` — what's staged, unstaged, untracked
   - `git diff master...HEAD --name-only` — what this branch changed vs. base
   - `git log master..HEAD --oneline` — commits on this branch

2. **Detect affected zones** from the changed file list:
   - Any `client/**` → client zone
   - Any `server/**` → server zone
   - Any `e2e/**` or cross-zone user flow change → e2e zone
   - Any `data.json` shape change → flag explicitly and confirm seed still loads

3. **Run the affected zones' checks** (in parallel where possible):

   | Zone | Test | Lint | Type check |
   |------|------|------|-----------|
   | client | `cd client && npm test` | `cd client && npm run lint` | `cd client && npm run build` (catches TS errors) |
   | server | `cd server && npm test` | — | `cd server && npx tsc --noEmit` |
   | e2e | `cd e2e && npm test` | — | — |

   If client changed, also run the client build — it's the de facto type check for that zone.

4. **Manual verification reminder:** if any `client/**` file changed, remind the user that the project's done criteria require manual verification in the browser in **both** light and dark mode. Ask whether they've done this. If they haven't, offer to start the dev server.

5. **Draft commit message** (if there are unstaged or uncommitted changes — if everything is already committed, skip to step 6):
   - Match the recent commit style: scan `git log --oneline -10` first
   - Short imperative subject (under 70 chars), focuses on **why** not what
   - Surface anything that touches guardrails (Claude model swap, data.json shape, auth, deps)
   - Show the draft and ask for approval before committing

6. **Draft PR** title and body:
   - Title: under 70 chars. If `$ARGUMENTS` was provided, use that.
   - Body uses this template:

     ```markdown
     ## Summary
     <1-3 bullets focused on the WHY, not the what>

     ## Delegations
     <Which agent did which slice of zone work. Be honest — if main did
     zone work inline rather than delegating, list that and flag for
     review. Format:
       - booksmith: <server work>
       - storefront: <client work>
       - qa: <test work>
       - main: <orchestration, cross-zone glue, 1-line fixes>
     If only main touched the branch (docs / tooling / pure orchestration),
     write "main only — no zone code touched">

     ## Test plan
     <Bulleted markdown checklist of TODOs for reviewer to verify>
     ```

   - The Delegations section is REQUIRED per CLAUDE.md — it's the audit trail for zone-ownership compliance. Do not omit it.
   - Show the draft and confirm before opening the PR

7. **Confirm and execute** — only after the user explicitly approves:
   - Push the branch (`-u` if first push)
   - Open the PR via `gh pr create`
   - Return the PR URL

## Guardrails

- Never `--no-verify`, never bypass hooks, never force-push.
- If pre-commit hooks fail, fix the underlying issue and create a **new** commit — never `--amend` an already-pushed commit.
- If tests fail, stop and report. Do not "fix and re-run" silently — surface the failure and let the user direct the fix.
- If the branch isn't named per the convention in `CLAUDE.md` (`feat/`, `fix/`, etc., or `agent/<type>/...`), flag it but don't rename without asking.
