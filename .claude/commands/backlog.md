---
description: Browse open GitHub issues grouped by milestone. Read-only — use to pick the next task before /start-task.
argument-hint: [milestone] (optional, e.g. "Foundation", "Tier 2 Storefront")
model: haiku
---

List open issues from the GitHub backlog (https://github.com/slickG0ose/storybook/issues) so the user can pick what to work on next. Read-only — NEVER create, edit, comment on, or close issues.

This command is the GitHub-Issues counterpart to `/status`. `docs/backlog.md` is a read-only archive as of 2026-05-22; all active backlog work lives on GitHub now.

## Steps

1. **Fetch open issues.** Run in parallel:
   - `gh issue list --state open --limit 100 --json number,title,labels,milestone,createdAt,updatedAt,url`
   - `gh api 'repos/:owner/:repo/milestones?state=open' --jq '[.[] | {title, open_issues, closed_issues}]'`

   If `$ARGUMENTS` is provided, narrow the first call with `--milestone "$ARGUMENTS"` (exact title match — case sensitive).

2. **Group and sort.** Group issues by milestone in the canonical order from `CLAUDE.md`:
   1. Foundation
   2. Harness Rebuild
   3. Tier 2 Storefront
   4. Illustration v2
   5. Mobile + Series
   6. Print/Subscription
   7. (no milestone — last)

   Within each milestone, sort by `updatedAt` descending (most-recently-touched first).

3. **Format the report** as plain markdown. Match the project's plain style — no emoji, no box-drawing, no decorative headers:

   ```
   ## Backlog — <YYYY-MM-DD>
   <N> open issues across <M> milestones.

   ### <Milestone name> (<open>/<open+closed> open)
   - #<num> — <title> [<label1>, <label2>] (<age>) — <url>
   - ...

   ### No milestone
   - <as above>
   ```

   - Omit the `[labels]` segment if the issue has no labels.
   - Age uses the shortest unit: `Nd` if <14d, `Nw` if <8w, `Nmo` otherwise. Source field is `updatedAt`.
   - Truncate titles >100 chars with an ellipsis.
   - Skip empty milestones (no open issues).

4. **Suggest the next action** in 1–2 bullets after the report:
   - If any **Foundation** issue is open, suggest clearing it first — Foundation is the dependency chain, analogous to old Tier 1 in `docs/backlog.md`.
   - Otherwise suggest the user pick an issue number and run `/start-task <issue-number>` to kick off a branch.
   - If `gh` reported partial results (e.g., milestone API failed), call that out so the user knows the grouping might be incomplete.

## Constraints

- Read-only. NEVER run `gh issue create | edit | close | comment | delete | reopen | pin | lock | transfer`.
- Output goes directly to the user as plain markdown. Do not wrap in a code block.
- If `gh` is not authenticated, surface the auth error and stop — partial output isn't useful here.
- Default model is Haiku (set in frontmatter) — this command is mechanical fetch + format. If the user passes a complex argument that needs judgment, mention that and proceed anyway.
