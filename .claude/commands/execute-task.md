---
description: Dispatch the developer agent to implement one task from .code-captain/specs/<slug>/tasks.md. Refuses to run if no tasks.md exists — forces the spec → plan → execute discipline.
argument-hint: <spec-slug> <task-number> (e.g., "pdf-export 2") — omit to list available specs + tasks
---

Run a single task from an approved task plan by dispatching the **developer** agent. The command is a thin discipline-enforcing wrapper around the agent — its job is to validate that the spec/plan exist, verify prerequisites, and hand a well-formed dispatch prompt to the developer.

## When to use

- After the architect has produced an approved `spec.md` + `tasks.md`, and you're ready to execute.
- For trivial work (1-2 file edits, single zone, no schema change), **don't use this command**. Dispatch the developer directly from the main session — or just edit yourself. `/execute-task` adds ceremony that's only worth it when the architect did real decomposition.

## Steps

1. **Parse arguments.** Expect `<spec-slug> <task-number>` (e.g., `pdf-export 2`). Two failure modes:

   - **No arguments:** list every `.code-captain/specs/*/tasks.md` you can find. For each spec, show its title and a per-task line: `Task N — <title> [Status: <not-started | Done | …>]`. Ask the user which `<slug> <task>` to run. Then proceed.
   - **One argument or malformed:** print the expected usage and stop. Don't guess.

2. **Hard refusal — no tasks.md.** If `.code-captain/specs/<slug>/tasks.md` doesn't exist, refuse with a message like:

   > No task plan found at `.code-captain/specs/<slug>/tasks.md`. The harness requires design → execute: dispatch the architect agent to produce `spec.md` and `tasks.md`, then re-run `/execute-task <slug> <task-number>`.

   Do **not** attempt to plan on the fly. Do **not** fall back to dispatching the developer with a freehand prompt. This refusal is the whole point of the command — it prevents the "skip-the-spec" failure mode.

3. **Load the task body.** Read `.code-captain/specs/<slug>/tasks.md` and find the requested task by its `### Task N — <title>` heading. Read the full task body: Zone, Depends on, Parallel-safe with, Files, Signatures, Tests, Manual verify, Done when.

4. **Verify prerequisites.** Inspect the task's `**Depends on:**` line and parse **every** task number referenced — the architect writes both singular (`Task 2`) and plural forms (`Tasks 2 and 3`, `Tasks 1, 3, and 5`). Extract all integers from the line, then for each one grep the task plan for the corresponding `### Task N` heading and confirm `**Status:** Done` appears in its body.
   - `none` → proceed.
   - One or more numbers extracted → check each. If **any** are not Done, refuse and list every incomplete prerequisite (not just the first one) so the user knows the full gap.

5. **Verify user-approval markers.** If the task body contains "USER CONFIRMATION REQUIRED" / "requires user approval" / similar, check that the user's most recent message in the conversation grants approval. If not, refuse and ask the user to confirm before re-running.

6. **Check status.** If the task already has `**Status:** Done`, ask the user whether to re-run anyway (rare — usually means the prior run was reverted). Default to NOT re-running.

7. **Dispatch the developer agent.** Use the `Agent` tool with `subagent_type: developer`. The dispatch prompt MUST include:

   - The spec slug (`pdf-export`)
   - The task number (`2`)
   - Any task-specific approvals carried over from step 5 (`User approved: <thing>`)
   - A reminder to follow the developer's role definition at `.claude/agents/developer.md` strictly

   The developer agent itself owns: reading the spec + conventions, implementing the task, running zone tests, marking the task `Status: Done`, and producing the hand-back report.

8. **Surface the hand-back.** When the developer returns, print its hand-back verbatim. Do not paraphrase. The hand-back contains:
   - Files changed
   - Tests run and their results
   - Manual-verify status
   - Surprises / decisions made
   - Suggested next step

9. **Suggest the next move.** The developer's hand-back already ends with a `Suggested next:` line — that is the source of truth for what to do next, because the developer is the one who knows whether this was the last task or whether more remain. Relay it. Layer on the following only when it adds value beyond what the developer said:

   - **If `Suggested next:` says "dispatch developer on Task N+1"** and you can see Task N+1 in `tasks.md`, offer the literal command (`/execute-task <slug> <N+1>`) so the user can copy-paste.
   - **If the hand-back's "Surprises / decisions made" section has items**, remind the user that Check 6 (reviewer, HR6) will flag orphaned surfaced gaps pre-merge; ask whether to address them now or open a tracking issue.
   - **If `Suggested next:` says "/ship to draft the PR"**, confirm that the plan's remaining tasks are all `Status: Done` (or explicitly out-of-PR-scope) before relaying — a "ship now" recommendation should match the actual state of the plan.
   - **If tests failed**, tell the user the task is not done; the developer should have already noted what failed.
   - **If manual verify is required but not done**, ask the user to verify in the browser using the steps in the task body. The developer's report says what to look at.

   Do not invent a next step the developer didn't suggest. If the hand-back is ambiguous, ask the user rather than guessing.

## Constraints

- **Read-only orchestration.** This command does not edit source code, run `npm install`, run `git commit`, or run `gh pr create`. The developer agent does the source edits; the user (or `/ship`) handles git.
- **One task per dispatch.** If the user asks for "Task 3 AND Task 4", run Task 3, surface the hand-back, then ask whether to re-run for Task 4.
- **Refuse on missing prereqs.** Don't paper over a missing `tasks.md` or a missing `Status: Done` on a dependency. The discipline this command exists to enforce is that *every implementation step starts from an approved plan*.
- **No silent dispatches.** Tell the user what you're about to do — "Dispatching developer on `pdf-export` Task 2" — before invoking the agent.
- **Trust the developer's tools.** Don't second-guess what the developer chose to do. If a finding emerges, the reviewer (`HR6`) will surface it pre-merge. This command's job ends at the hand-back.
