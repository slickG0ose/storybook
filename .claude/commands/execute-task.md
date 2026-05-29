---
description: Dispatch the developer agent to implement one task from .code-captain/specs/<slug>/tasks.md. Refuses to run if no tasks.md exists — forces the spec → plan → execute discipline.
argument-hint: <spec-slug> <task-number> (e.g., "pdf-export 2") — omit to list available specs + tasks
---

Run a single task from an approved task plan by dispatching the **developer** agent. The command is a thin discipline-enforcing wrapper around the agent — its job is to validate that the spec/plan exist, verify prerequisites, and hand a well-formed dispatch prompt to the developer.

## When to use

- After the architect (`spec.md`) and planner (`tasks.md`) have produced an approved plan, and you're ready to execute one task.
- For trivial work (1-2 file edits, single zone, no schema change), **don't use this command**. Dispatch the developer directly from the main session — or just edit yourself. `/execute-task` adds ceremony that's only worth it when the planner did real decomposition.

## Steps

1. **Parse arguments.** Expect `<spec-slug> <task-number>` (e.g., `pdf-export 2`). Two failure modes:

   - **No arguments:** list every `.code-captain/specs/*/tasks.md` you can find. For each spec, show its title and a per-task line: `Task N — <title> [Status: <not-started | Done | …>]`. Ask the user which `<slug> <task>` to run. Then proceed.
   - **One argument or malformed:** print the expected usage and stop. Don't guess.

2. **Hard refusal — no tasks.md.** If `.code-captain/specs/<slug>/tasks.md` doesn't exist, refuse with a message like:

   > No task plan found at `.code-captain/specs/<slug>/tasks.md`. The harness requires spec → plan → execute: run `/edit-spec` (or have the architect draft a spec at `.code-captain/specs/<slug>/spec.md`), then dispatch the planner agent to produce `tasks.md`, then re-run `/execute-task <slug> <task-number>`.

   Do **not** attempt to plan on the fly. Do **not** fall back to dispatching the developer with a freehand prompt. This refusal is the whole point of the command — it prevents the "skip-the-spec" failure mode.

3. **Load the task body.** Read `.code-captain/specs/<slug>/tasks.md` and find the requested task by its `### Task N — <title>` heading. Read the full task body: Zone, Depends on, Parallel-safe with, Files, Signatures, Tests, Manual verify, Done when.

4. **Verify prerequisites.** Inspect the task's `**Depends on:**` line:
   - `none` → proceed.
   - `Task N` → grep the task plan for that task's heading and confirm `**Status:** Done` appears in its body. If not, refuse and tell the user which prerequisite task is incomplete.

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

9. **Suggest the next move.** Based on the hand-back:
   - "Tests pass + no surprises" → suggest `/ship` to draft a PR
   - "Tests pass + surprises noted" → remind the user that Check 6 (reviewer) will flag those if they're not addressed; ask whether to address them in this dispatch or open a follow-up
   - "Tests failed" → tell the user the task is not done; the developer should have already noted what failed
   - "Manual verify required but not done" → ask the user to verify in the browser; the developer's report says what to look at

## Constraints

- **Read-only orchestration.** This command does not edit source code, run `npm install`, run `git commit`, or run `gh pr create`. The developer agent does the source edits; the user (or `/ship`) handles git.
- **One task per dispatch.** If the user asks for "Task 3 AND Task 4", run Task 3, surface the hand-back, then ask whether to re-run for Task 4.
- **Refuse on missing prereqs.** Don't paper over a missing `tasks.md` or a missing `Status: Done` on a dependency. The discipline this command exists to enforce is that *every implementation step starts from an approved plan*.
- **No silent dispatches.** Tell the user what you're about to do — "Dispatching developer on `pdf-export` Task 2" — before invoking the agent.
- **Trust the developer's tools.** Don't second-guess what the developer chose to do. If a finding emerges, the reviewer (`HR6`) will surface it pre-merge. This command's job ends at the hand-back.
