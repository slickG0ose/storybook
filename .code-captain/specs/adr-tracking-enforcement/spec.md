# ADR-tracking enforcement (skill + reviewer + planner)

> Status: Draft
> Last updated: 2026-06-03
> Architect: Claude Opus 4.8 (1M context) via @architect on 2026-06-03
> Backlog: https://github.com/slickG0ose/storybook/issues/53

## Problem

When the architect flags ADR-worthy decisions in a `spec.md` (and the planner echoes/adds to them in `tasks.md`), nothing forces those items to be tracked before merge. The planner's standard punt language ("created via `/create-adr` post-spec-approval, OR captured as a follow-up issue") *surfaces* the obligation but doesn't *enforce* it: no task's "Done when" references the items, so a developer reading `tasks.md` has no reason to action them. The only backstop is the reviewer's Check 6 at `/ship`-time, which produces a Medium-severity finding — easy to miss if the reviewer is run less rigorously, and easy to drown out when a spec carries many ADR-worthy items. This was surfaced by the theater-mode (TS1) reviewer dispatch (issue #53). The fix moves the obligation from "discipline by careful reading" to "mechanical check wired into the developer's execution path," consistent with the HR-series philosophy of mechanical enforcement over documented procedure.

The decided direction (not re-litigated here) is the **"skill + reviewer + planner"** hybrid of issue #53's Options 1 and 3. Option 2 (an early `/ship` grep before the reviewer) was rejected as redundant once Check 6 delegates to the skill. Option 4 (docs-only) was rejected as the weakest enforcement.

## Constraints

- **Harness/docs zone only.** No application code, no Prisma schema, no Zod wire shapes, no new runtime dependency. The only files touched are under `.claude/` and `docs/conventions/`.
- **Match existing mechanical-check skill conventions.** The new skill must mirror `.claude/skills/wire-shape-check/SKILL.md` and `.claude/skills/dark-mode-parity-check/SKILL.md` in frontmatter and section structure. It is a *check*, not a mutator — no Edit/Write, hand back a structured report.
- **"Adapt don't bloat" (user value).** Keep the skill terse and signal-heavy. The two existing skills are the size ceiling; this one is simpler (no Tailwind-class taxonomy, no wire-shape carve-outs) and should be shorter, not longer.
- **Reviewer Check 6 is partly preserved.** The skill covers only the spec/tasks ADR-item portion of Check 6. The developer-hand-back "Surprises" scanning and the commit-message phrase scanning stay inline in the reviewer — they are not ADR-specific and have no skill.
- **Harness-resolution snapshot is gated by vitest.** `scripts/audit-resolution.mjs` enumerates every `.claude/skills/*/SKILL.md` (by frontmatter) and every agent's description into `docs/conventions/harness-resolution.md`. The vitest suite `.claude/__tests__/references/resolution-snapshot.test.ts` (run by `npm test`) re-derives that string and fails on drift. Adding the new skill and editing the reviewer's description **will** change the snapshot; regenerating it via `npm run audit:resolution` is part of the work.
- **`surfaced-gaps-tracking` user memory** is the policy this enforces: every surfaced gap needs a tracking action (fix-in-PR, follow-up issue, or explicit defer). The skill operationalizes the ADR-item slice of that policy.

## Proposed shape

Three coordinated harness edits, no code:

1. **New skill `adr-tracking-check`** at `.claude/skills/adr-tracking-check/SKILL.md` — the mechanical implementation of the ADR-item slice of reviewer Check 6, exactly as `wire-shape-check` implements Check 4 and `dark-mode-parity-check` implements Check 3. Given a spec slug (or explicit `spec.md` + `tasks.md` paths), it enumerates every ADR-worthy item declared in those two files and, for each, verifies that exactly one tracking action exists: a matching ADR entry in `.code-captain/product/decisions.md`, a linked follow-up GitHub issue, or an explicit `Deferred:` line with reasoning. It reports orphaned items (those with no tracking action) and hands back a structured report. No file mutation.

2. **Reviewer Check 6 rewrite** in `.claude/agents/reviewer.md` (current lines ~141–164). The ADR-item portion of the check gains a "**Mechanical procedure:** invoke the `adr-tracking-check` skill …" preamble, word-for-word in the style of Check 3 (line 86) and Check 4 (line 109). The non-ADR portions of Check 6 — scanning the developer hand-back "Surprises / decisions made" section and scanning commit messages for surfaced-gap phrases — remain inline and unchanged, because they are not ADR-specific and the skill does not cover them.

3. **New planner rule** in `.claude/agents/planner.md`. When the spec carries ADR-worthy items, the generated `tasks.md` MUST include a final task ("Pre-merge follow-ups") whose "Done when" runs `adr-tracking-check` and requires zero orphaned items. This is the load-bearing change: it puts the ADR obligation into the developer's execution path (a real "Done when"), which is exactly what issue #53 identifies as missing today.

The three changes are mutually reinforcing: the skill is the single source of the rule; the planner makes it appear as a developer task so it's actioned during execution; the reviewer makes it the pre-merge backstop so a skipped task is still caught at `/ship`.

### Schema / contract changes

None in the application sense (no Zod, no Prisma). The "contracts" here are the section headings the skill parses out of `spec.md` and `tasks.md`. These already exist in the architect/planner templates and in the live theater-mode files:

- **`spec.md`** — section heading `## ADR-worthy decisions`, items as Markdown checkbox bullets (`- [ ] **<decision>** — <reasoning>`). Confirmed in `.code-captain/specs/theater-mode/spec.md` line 176+.
- **`tasks.md`** — two possible sources: a section literally titled `## Open questions` (planner template line 113) and/or an ADR-items section (theater-mode used `## ADR-worthy items beyond the spec's existing 5`, line 352). The skill must tolerate both headings; it greps for ADR-worthy-item bullets within any section whose heading contains "ADR-worthy" or "Open questions" (case-insensitive).
- **`.code-captain/product/decisions.md`** — append-only log; ADR entries are `## ADR-NNN — <title>` with a `**Scope:**` line that frequently names the spec slug and PR (confirmed at ADR-004 for theater-mode). A "matching ADR entry" is one whose title or scope line references the decision's subject or the spec slug.

No heading or template changes are proposed. If the architect/planner templates need a tightened, machine-parseable convention for ADR-item bullets, that is called out as an open question below rather than baked in here.

### Data flow

End-to-end, there is no runtime/user flow — this is a harness-time check. The invocation flow:

1. **Planner** decomposes an accepted spec. If `spec.md` has a non-empty `## ADR-worthy decisions` section, the planner appends a final "Pre-merge follow-ups" task whose "Done when" includes "run `adr-tracking-check <slug>`; zero orphaned items."
2. **Developer**, executing that final task, invokes `adr-tracking-check <slug>` as a self-check (mirrors how the developer is told to self-run `wire-shape-check` / `dark-mode-parity-check` before marking a task Done). For each orphaned item the developer either writes the ADR (`/create-adr`), opens a follow-up issue and links it, or adds a `Deferred:` line — then re-runs the skill until clean.
3. **Reviewer**, at `/ship`, runs Check 6. Its ADR-item portion invokes `adr-tracking-check` and uses its findings; the Surprises/commit-message portions run inline as before. Orphaned items become Medium findings as today — but should now be rare because the developer already cleared them.

State lives entirely in files already in the repo (`spec.md`, `tasks.md`, `decisions.md`) plus GitHub issues. The skill reads; it never writes.

### Files likely touched

- `.claude/skills/adr-tracking-check/SKILL.md` — **new.** The mechanical check; mirrors wire-shape-check structure.
- `.claude/agents/reviewer.md` — Check 6 rewrite: add the skill-delegation preamble to the ADR-item portion; preserve Surprises + commit-message portions inline.
- `.claude/agents/planner.md` — add the "Pre-merge follow-ups" task rule to the task-generation guidance (workflow step 4 / sizing heuristics area) and to the `tasks.md` template (a conditional final-task block + a note in `## Open questions` guidance).
- `docs/conventions/harness-resolution.md` — **regenerated** via `npm run audit:resolution` to pick up the new skill row and the reviewer's (possibly unchanged) description. Required so the vitest snapshot gate passes.
- `CLAUDE.md` — **candidate, not certain.** The "Reviewer agent and mechanical-check skills" section lists the two existing skills and which checks they back. Adding a third skill row there keeps that section accurate. Flag for the planner to decide whether this is in-scope or a trivial follow-up. (One-line addition; low risk.)

No edits to `wire-shape-check` or `dark-mode-parity-check` — the new skill stands alongside them.

## Alternatives considered

The option choice (skill + reviewer + planner) is already decided per issue #53; these are residual shape alternatives within that decision.

### A — Skill takes a spec slug only (vs. accepting explicit file paths)

Slug-only is simplest: `adr-tracking-check theater-mode` resolves `.code-captain/specs/theater-mode/{spec,tasks}.md` by convention.

**Pros:** terse invocation; matches the slug-centric harness vocabulary.
**Cons:** can't run against a spec/tasks pair that isn't yet in the canonical location; less flexible for ad-hoc use.
**Why rejected (as sole input):** the existing skills accept explicit paths (`wire-shape-check` takes a route path; `dark-mode-parity-check` takes file paths or defaults to a diff). For consistency and ad-hoc use, the skill should accept **either** a slug **or** explicit `spec.md`/`tasks.md` paths, defaulting slug→canonical paths. This is the chosen shape.

### B — Planner always emits the "Pre-merge follow-ups" task (vs. only when ADR items exist)

Always-emit removes a conditional and guarantees the task is present.

**Pros:** no "did the planner check the spec section?" failure mode; uniform task lists.
**Cons:** adds a no-op task to every plan whose spec has zero ADR-worthy items — ceremony for the (common) small feature, against "adapt don't bloat." The skill on an empty item set is a clean no-op anyway, so the task would just say "nothing to track."
**Why rejected:** conditional emission (only when `## ADR-worthy decisions` is non-empty) keeps small plans lean. The planner already reads the full spec (workflow step 1), so detecting a non-empty section is free. Considered as an upgrade path if planners are observed skipping the conditional.

### C — Skill mutates: auto-files follow-up issues / writes Deferred lines

The skill could open a GitHub issue per orphaned item, or stamp `Deferred:` lines automatically.

**Pros:** zero manual follow-through.
**Cons:** breaks the established "checks don't mutate" contract that both existing skills state explicitly in their "What this skill does NOT do" sections; the reviewer has no Edit/Write either. Auto-deferring also lets real decisions slip without a human choosing the tracking action.
**Why rejected:** consistency with the two existing skills and the reviewer's read-only stance. The human (or a developer dispatch) picks the tracking action; the skill only reports.

## Success criteria

- `.claude/skills/adr-tracking-check/SKILL.md` exists with frontmatter (`name`, `mode: agent`, `description`, `argument-hint`) and the same section spine as `wire-shape-check` (When to invoke / Inputs / Procedure / Output format / What this skill does NOT do / Related).
- Running the skill against `theater-mode` (which has ADR-worthy items in both `spec.md` and `tasks.md`, and ADR-004 already written) correctly reports the items covered by ADR-004 as **tracked** and any uncovered item (e.g. the task-surfaced test-mock-pattern item, which ADR-004 did not formalize) as **orphaned or Deferred** per its actual state — i.e. the skill's enumeration matches a hand audit of the two files.
- `.claude/agents/reviewer.md` Check 6's ADR-item portion opens with a "Mechanical procedure: invoke the `adr-tracking-check` skill …" preamble matching the phrasing of Checks 3 and 4; the Surprises and commit-message portions are still present and inline.
- `.claude/agents/planner.md` instructs: when `spec.md` has a non-empty ADR-worthy-decisions section, append a final "Pre-merge follow-ups" task whose "Done when" runs `adr-tracking-check` with zero orphaned items; the `tasks.md` template shows this conditional task.
- `npm test` is green — specifically `.claude/__tests__/references/resolution-snapshot.test.ts` passes after `docs/conventions/harness-resolution.md` is regenerated. No new TypeScript errors.
- The skill body is no longer than `wire-shape-check`'s ~160 lines (signal-density check, per "adapt don't bloat").

## Out of scope

- **Changing the architect/planner spec/tasks templates** to a stricter machine-parseable ADR-item format. The skill adapts to the *existing* headings; if parsing proves brittle, tightening the templates is a separate follow-up (see open questions).
- **An early `/ship` grep before the reviewer dispatch** (issue #53 Option 2) — explicitly rejected as redundant once Check 6 delegates to the skill.
- **A `/create-adr` workflow change.** The skill checks for ADR *presence*; it does not author ADRs or alter the `/create-adr` command.
- **Auto-filing follow-up issues or auto-writing Deferred lines** (alternative C) — the skill is read-only.
- **Enforcement for non-ADR surfaced gaps** (the Surprises/commit-message portions of Check 6). Those stay as inline reviewer prose; no skill, no planner task.
- **Retroactively tracking ADR items on already-merged features.** This enforces forward; historical specs are not swept.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| Skill parsing is brittle — ADR-item bullets use inconsistent headings/formatting across specs (theater-mode used `## ADR-worthy items beyond the spec's existing 5` in tasks, the template says `## Open questions`). | Skill greps for any heading containing "ADR-worthy" or "Open questions" (case-insensitive) and treats checkbox/`- ` bullets under them as items; reports `<unparseable — review by hand>` rather than silently skipping, mirroring the heuristic-limits honesty of `dark-mode-parity-check`. |
| Stale harness-resolution snapshot fails `npm test` and blocks the PR. | Spec explicitly lists snapshot regeneration (`npm run audit:resolution`) as required work; planner turns it into a task with the vitest gate as its Done-when. |
| "Matching ADR entry" detection is fuzzy — an ADR may cover a decision without naming it verbatim (ADR-004 bundles six decisions under one entry). | Skill matches on spec-slug reference in the ADR's `**Scope:**`/title line as the primary signal, and reports near-misses as `<possible match — confirm>` rather than asserting tracked/orphaned with false confidence. The human confirms ambiguous matches. |
| Planner conditional is skipped (planner forgets to check the spec section). | Reviewer Check 6 remains the backstop — an orphaned item still surfaces at `/ship` even if the planner omitted the task. Defense in depth is intentional. |
| Scope creep: editing `CLAUDE.md`'s skill list pulls in a doc not strictly required for the feature to work. | Flagged as a candidate, not certain. Planner decides whether the one-line `CLAUDE.md` addition is bundled or split into a trivial docs follow-up. The feature functions without it. |
| Over-engineering the skill against "adapt don't bloat." | Success criteria caps the skill at ~160 lines; it has no taxonomy tables (unlike dark-mode-parity-check) and no carve-outs (unlike wire-shape-check) — it is the simplest of the three. |

## ADR-worthy decisions

- [x] **Mechanical-check skills are the canonical home for each reviewer check's rule** — i.e. when a reviewer check has a deterministic rule, it is extracted into a `.claude/skills/<name>-check/SKILL.md` and the reviewer delegates via a "Mechanical procedure: invoke the … skill" preamble. This is the *third* instance of the pattern (after wire-shape-check/Check 4 and dark-mode-parity-check/Check 3). **Judgment: this is following established precedent, not a new hard-to-reverse decision** — the pattern is already de facto. It likely does **not** warrant its own ADR; if the user wants the pattern named once for posterity, a single short ADR covering "reviewer-check → skill extraction is the convention" would be the place, not three separate ADRs. Recommend: skip unless the user wants the meta-pattern pinned.
  - **Deferred:** not writing a standalone ADR for this meta-pattern (user decision, 2026-06-03). Rationale: it's the third instance of an already de-facto convention, not a new hard-to-reverse decision. ADR-005 records the convention in passing (its Consequences note the "reviewer-check → skill extraction" pattern). Revisit only if the meta-pattern is ever contested and needs a named decision of its own.

- [x] **The "Pre-merge follow-ups" task is conditional (emitted only when the spec has ADR-worthy items), not unconditional** — alternative B. This shapes every future plan the planner produces. Reversing it (to always-emit) is a one-line planner-rule change but affects the texture of all task lists. **Judgment: worth a brief ADR** because it's a standing planner-behavior rule and future planners will want the rationale ("adapt don't bloat — no no-op tasks on small plans") rather than re-deriving it.
  - **Tracked by [ADR-005](../../product/decisions.md)** (written 2026-06-03): "'Pre-merge follow-ups' task is conditionally emitted by the planner."

(No other hard-to-reverse choices. The skill's input shape and read-only stance follow existing skill precedent and need no ADR.)
