---
description: Orient to the current state of work — git, PRs, backlog, suggested next actions. Use when starting a fresh session or switching context.
argument-hint: (no arguments)
---

Show a structured status report so the user can resume work without re-reading recent history. Read-only — NEVER modify files, commit, or push.

## Steps

1. **Gather state.** Run these in parallel (one Bash call per concern is fine — they're independent):
   - `git fetch origin --quiet` (refresh remote-tracking refs)
   - `git rev-parse --abbrev-ref HEAD` (current branch)
   - `git status --short` (uncommitted + untracked)
   - `git log --oneline -5` (recent commits on branch)
   - `git log origin/master..HEAD --oneline` (commits ahead of master)
   - `git log HEAD..origin/master --oneline` (commits behind master)
   - `git diff --check` (conflict markers in working tree)
   - `gh pr list --author @me --state open --json number,title,url,baseRefName,isDraft` (your open PRs)

2. **Read** `docs/backlog.md` and extract:
   - Count of `[ ]` (open) vs `[x]` (done) items per tier heading
   - The first 3 unchecked items in tier order (T1 first, then T2, then T3/OPS)
   - Any content in the "Working notes" section — scratchpads from prior sessions matter for orientation

3. **Detect branch-convention compliance.** A branch passes the convention from `CLAUDE.md` if it matches one of:
   - `feat/...`, `fix/...`, `chore/...`, `docs/...`, `test/...`, `refactor/...`
   - `agent/<type>/...` (worktree branches)
   - `master`

   Branches like `claude/<random>` predate the convention — flag as informational, not an error.

4. **Format the report** as plain markdown using this template. No box-drawing characters, no decorative emoji, no Code Captain branding — match the project's plain-markdown style:

   ```
   ## Status — <YYYY-MM-DD>

   ### Branch
   - **Current:** `<branch>` <convention status: matches | predates convention | does not match>
   - **vs origin/master:** <N ahead, M behind | up to date>
   - **Working tree:** <clean | summarize: "3 modified in client/, 1 untracked">
   - **Last commit:** "<subject>" (<relative time>)

   ### Open PRs (yours)
   <bullet per PR: #<num> — <title> [draft|ready] → <baseRefName>, or "none">

   ### Backlog (docs/backlog.md)
   - Tier 1: <open>/<total> open
   - Tier 2: <open>/<total> open
   - Tier 3 (OPS): <open>/<total> open

   **Next up:**
   - <ID> — <summary>
   - <ID> — <summary>
   - <ID> — <summary>

   ### Working notes
   <content of Working notes section from backlog.md, or "none">

   ### Suggested next actions
   <2-4 bullets, picked from the logic below>
   ```

5. **Suggestion logic** — surface 2-4 most-relevant items for current state:

   | State | Suggestion |
   |-------|-----------|
   | Merge conflict markers detected | Resolve conflicts in listed files before continuing |
   | Branch behind master | Rebase: `git fetch origin && git rebase origin/master` |
   | Uncommitted changes, no open PR for this branch | Mid-task. Run `/verify` to sanity-check, or `/ship` when ready |
   | Clean tree, on `master` | Run `/start-task` to pick a backlog item |
   | Clean tree, on feature branch, PR open | PR awaiting review. Check `gh pr view <N>` for comments |
   | Branch name predates convention | Optional: rename with `git branch -m <new-name>` (only if not yet pushed) |
   | Working notes scratchpad exists | Prior session left notes — review the Working notes section before continuing |
   | Open backlog Tier 1 item exists | Tier 1 is the dependency chain — clear it before Tier 2/3 |

## Constraints

- Read-only. NEVER stage, commit, push, or modify files.
- Run git/gh calls in parallel where independent — total wall-clock under ~3 seconds expected.
- Output goes directly to the user as plain markdown. Do not wrap it in a code block.
- If `gh` isn't authenticated or `git fetch` fails, surface the error in the report rather than aborting — partial signal is better than none.
