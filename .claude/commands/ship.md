---
description: Pre-flight a branch for PR — detect changed zones, run their tests, lint, draft commit + PR
argument-hint: [pr-title] (optional — overrides auto-drafted title)
---

Get the current branch ready to ship. Follow the project's done criteria in `CLAUDE.md` strictly. Do **not** push or open a PR without explicit user confirmation.

## Steps

0. **Verify feature branch.** Run `git rev-parse --abbrev-ref HEAD`. If on `master`/`main`/`develop`, stop and tell the user — `/ship` only works on feature branches (CLAUDE.md trunk-based + PR convention; remote rejects direct pushes; the local `guard-bash.sh` hook also blocks commits on protected branches). Offer to create one with `git switch -c <type>/<descriptor>`.

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

6. **Dispatch the reviewer agent** (pre-merge mode). All zone checks have passed and the diff is committed — now run the structural / convention checks before drafting the PR.

   Use the `Agent` tool with `subagent_type: reviewer`. Dispatch prompt MUST include:

   - Mode: `pre-merge`
   - Base ref: `master...HEAD` (the reviewer reads `git diff master...HEAD`)
   - The spec slug, if one applies (`.code-captain/specs/<slug>/spec.md` referenced by the branch's commits or by recent dispatches)
   - A reminder to follow the reviewer's role definition at `.claude/agents/reviewer.md` strictly

   The reviewer will return a findings report with severity per finding. Surface it verbatim to the user. Then:

   - **No findings** → proceed to step 7
   - **Low-severity findings only** → relay them and ask whether to proceed; defaulting to proceed is fine
   - **Medium or higher findings** → stop the ship flow. Tell the user the reviewer flagged blockers, and ask whether to address now (re-edit, re-commit, re-run `/ship`) or override with explicit acknowledgement

   The reviewer never fixes findings. That's deliberate — the gate's value is independent flagging.

7. **Draft PR** title and body:
   - Title: under 70 chars. If `$ARGUMENTS` was provided, use that.
   - Body uses this template:

     ```markdown
     ## Summary
     <1-3 bullets focused on the WHY, not the what>

     ## Plan/spec link + agent ownership
     <Both pieces of audit trail:

     1. SPEC/PLAN — if the work flowed through the hybrid chain, link
        the spec and tasks files:
          - Spec:  `.code-captain/specs/<slug>/spec.md`
          - Tasks: `.code-captain/specs/<slug>/tasks.md` (Task N of M)
        If the work bypassed the chain (per CLAUDE.md size gate), say so
        explicitly: "Bypassed chain — trivial per size gate (1-2 files,
        single zone, no schema/deps)".

     2. AGENT OWNERSHIP — which agent did which slice. Be honest:
          - architect: <spec authoring> (if applicable)
          - planner: <task decomposition> (if applicable)
          - developer: <task implementations — list which tasks>
          - reviewer: pre-merge gate via /ship
          - qa: <e2e / test-infra work, if any>
          - storefront / booksmith: <legacy zone owners — only if used; flag for HR10 archive>
          - main: <orchestration, cross-zone glue, 1-line fixes>
        If only main touched the branch (docs / tooling / pure orchestration),
        write "main only — no zone code touched">

     ## Reviewer findings
     <Either "Reviewer: all six checks passed" OR a brief recap of any
     findings + how they were addressed (fixed in-PR, follow-up issue
     filed, explicit deferral with reasoning). This makes the surfaced-
     gaps follow-through (Check 6) traceable in the PR itself.>

     ## Test plan
     <Bulleted markdown checklist of TODOs for reviewer to verify>
     ```

   - The `## Plan/spec link + agent ownership` section is REQUIRED — it's the audit trail for the hybrid harness. Do not omit it. (Replaces the prior `## Delegations` section.)
   - The `## Reviewer findings` section is REQUIRED — it traces what the reviewer caught and what was done about it.
   - Show the draft and confirm before opening the PR

8. **Confirm and execute** — only after the user explicitly approves:
   - Push the branch (`-u` if first push)
   - Open the PR via `gh pr create`
   - Return the PR URL

## Guardrails

- Never `--no-verify`, never bypass hooks, never force-push.
- If pre-commit hooks fail, fix the underlying issue and create a **new** commit — never `--amend` an already-pushed commit.
- If tests fail, stop and report. Do not "fix and re-run" silently — surface the failure and let the user direct the fix.
- If the branch isn't named per the convention in `CLAUDE.md` (`feat/`, `fix/`, etc., or `agent/<type>/...`), flag it but don't rename without asking.
