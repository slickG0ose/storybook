# ADR-tracking enforcement (skill + reviewer + planner) — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-06-03
> Planner: Claude Opus 4.8 (1M context) via @planner on 2026-06-03

## Overview

Five ordered tasks, all in the harness/docs zone — no application code, no Prisma, no deps. Tasks 1–3 are the three coordinated harness edits (new skill, reviewer Check 6 rewrite, planner rule); they touch disjoint files and are parallel-safe with each other. Task 4 regenerates the vitest-gated harness-resolution snapshot and **must run last** (after 1–3 land) because adding the skill and editing the reviewer description both drift the snapshot. Task 5 is the dogfood + validation gate: run the new skill against this very spec (which carries ADR-worthy items) and resolve each one, proving the skill works end-to-end before merge.

## Cross-cutting constraints

Carried over from the spec — the rules the developer must obey:

- **Zone:** harness/docs only. Only files under `.claude/` and `docs/conventions/` (plus a one-line `CLAUDE.md` addition, Task 1). No application code, no Prisma, no Zod, no new dependency. If a task seems to want code, stop and hand back.
- **Wire-shape (OPS.3):** N/A — no server routes touched.
- **Dark-mode parity:** N/A — no `client/**` changes.
- **Migrations:** N/A — no schema change.
- **Checks don't mutate:** the new skill is read-only (no Edit/Write), mirroring `wire-shape-check` and `dark-mode-parity-check`. It reports; the human picks the tracking action. (Alternative C rejected in spec.)
- **"Adapt don't bloat":** the new skill is capped at ~160 lines (the `wire-shape-check` size ceiling) and should be the *simplest* of the three — no taxonomy tables, no carve-outs. Signal-density is a success criterion.
- **Snapshot gate:** `.claude/__tests__/references/resolution-snapshot.test.ts` (run by `npm test`) re-derives `docs/conventions/harness-resolution.md` from the `.claude/` tree and fails on drift. Any task that adds the skill or edits an agent description drifts it. Regenerate via `npm run audit:resolution` (Task 4) — do **not** hand-edit the snapshot, and do **not** import the `.mjs` from a test (Vitest 4 on Windows rejects that; the npm script runs `node` directly, which is fine).
- **Guardrails touched:** none from the CLAUDE.md guardrail list. The work *extends* the harness's own enforcement machinery but touches no data, model, paid-API, session, or test-deletion guardrail.

## Decisions on the architect's two open questions

The architect left two questions for the planner. Decided here (not punted back):

1. **One-line `CLAUDE.md` skill-list addition — bundled, not split.** The "Reviewer agent and mechanical-check skills" section (CLAUDE.md lines 92–97) and the Pointers line (line 140) list the two existing skills and which checks they back. Adding a third row keeps the doc accurate; it is one line in two places, zero risk, and splitting it into a trivial follow-up would itself be an orphaned surfaced-gap. **Bundled into Task 1.**

2. **Stricter machine-parseable ADR-item heading template — OUT of scope.** Per the spec's "Out of scope" and the brittleness risk row, the skill *adapts to existing headings* (`## ADR-worthy decisions` in specs; `## Open questions` or any "ADR-worthy" heading in tasks) and reports `<unparseable — review by hand>` rather than silently skipping. Tightening the architect/planner templates is a separate follow-up if parsing proves brittle in practice. Not in this plan.

## Tasks

### Task 1 — New skill `adr-tracking-check` (+ CLAUDE.md skill-list row)

**Status:** Done (2026-06-03)

**Zone:** docs (harness)
**Depends on:** none
**Parallel-safe with:** Tasks 2, 3

**Files to add or change:**

- `.claude/skills/adr-tracking-check/SKILL.md` — **new.** The mechanical implementation of the ADR-item slice of reviewer Check 6. Read-only check.
- `CLAUDE.md` — add a third skill row to the "Reviewer agent and mechanical-check skills" section (after line 97) and append `adr-tracking-check` to the Pointers line (line 140). One line each; do not restructure the section.

**Structure / shape (mirror `wire-shape-check/SKILL.md`):**

Frontmatter, exact key order matching the two existing skills (the audit script reads `name`, `mode`, `description` by frontmatter):

```yaml
---
name: adr-tracking-check
mode: agent
description: Given a spec slug (or explicit spec.md + tasks.md paths), enumerate every ADR-worthy item and verify each has exactly one tracking action — a matching ADR in decisions.md, a linked follow-up issue, or an explicit Deferred: line. Reports orphaned items. Read-only; the mechanical procedure for the ADR-item slice of reviewer Check 6.
argument-hint: "<spec-slug>  (or: <spec.md-path> <tasks.md-path>)"
---
```

Section spine (same as `wire-shape-check`): **When to invoke / Inputs / Procedure (numbered steps) / Output format / What this skill does NOT do / Related.** Add a short **Heuristic limits** block (mirror `dark-mode-parity-check`) for the fuzzy-match honesty.

Procedure the body must encode:

- **Inputs:** accept *either* a slug (resolve to `.code-captain/specs/<slug>/{spec,tasks}.md`) *or* two explicit paths. Slug→canonical-path default. If paths don't resolve, stop and report misuse (don't be clever) — same stance as `wire-shape-check`.
- **Step 1 — Enumerate ADR-worthy items.** In `spec.md`: items under the `## ADR-worthy decisions` heading, as `- [ ] **<decision>** — <reasoning>` checkbox bullets. In `tasks.md`: items under any heading containing "ADR-worthy" or "Open questions" (case-insensitive) — theater-mode used `## ADR-worthy items beyond the spec's existing 5`; the planner template uses `## Open questions`. Tolerate both. Treat `- ` / `- [ ]` bullets as candidate items. Report any item it cannot parse as `<unparseable — review by hand>` rather than dropping it silently.
- **Step 2 — For each item, find exactly one tracking action:**
  - **Matching ADR** in `.code-captain/product/decisions.md` — entries are `## ADR-NNN — <title>` with a `**Scope:**` line. Primary signal: the ADR's title or `**Scope:**` line references the spec slug (e.g. ADR-004's scope names `theater-mode`) or the decision's subject. One ADR may bundle several decisions (ADR-004 bundles all five theater-mode items under one entry) — count that as covering each bundled item.
  - **Linked follow-up issue** — a GitHub issue referenced near the item (`#NN` / `Follow-up: #NN`). The skill may note the reference; it need not call `gh` unless a path is given.
  - **Explicit `Deferred:`** line — a `Deferred:` (or `**Judgment:** ... skip`/`defer`) annotation on the item with reasoning, e.g. theater-mode's task-surfaced test-mock-pattern item which is explicitly deferred.
  - **Fuzzy matches:** when an ADR plausibly but not verbatim covers an item, report `<possible match — confirm>` rather than asserting tracked/orphaned. The human confirms. (Mirrors the "matching ADR detection is fuzzy" risk mitigation.)
- **Step 3 — Report.** Items with no tracking action are **orphaned**. Structured report; clean run is one paragraph; a failing run names every orphaned item.

**"What this skill does NOT do" (must state, mirroring existing skills):** does not author ADRs (no `/create-adr` change), does not open issues, does not write `Deferred:` lines, does not modify any file. Read-only.

**Tests to write:**

- None. This is a markdown skill descriptor, not code. Its behavioral validation is Task 5 (run it against this spec) and the success criterion of running it against `theater-mode` matching a hand audit.
- Wire-shape assertion required: no.

**Manual verify:** none (no UI).

**Done when:**

- `.claude/skills/adr-tracking-check/SKILL.md` exists with the frontmatter above and the full section spine (When to invoke / Inputs / Procedure / Heuristic limits / Output format / What this skill does NOT do / Related).
- Body is ≤ ~160 lines (the `wire-shape-check` ceiling); no taxonomy tables.
- `CLAUDE.md` lists `adr-tracking-check` in the mechanical-check skills section and the Pointers line.
- `npm test` is **expected to FAIL** on `resolution-snapshot.test.ts` after this task in isolation — that is correct and resolved by Task 4. Do not regenerate the snapshot here; let Task 4 do it after all three edits land. (Note this in the hand-back so it isn't mistaken for a regression.)
- No new TypeScript errors.

---

### Task 2 — Reviewer Check 6 rewrite (delegate ADR-item portion to the skill)

**Status:** Done (2026-06-03)

**Zone:** docs (harness)
**Depends on:** none (references the skill by name; doesn't require it to exist to edit the prose)
**Parallel-safe with:** Tasks 1, 3

**Files to add or change:**

- `.claude/agents/reviewer.md` — Check 6 region, currently lines ~141–164.

**Shape:**

- Add a **"Mechanical procedure: invoke the `adr-tracking-check` skill …"** preamble to the **ADR-item portion** of Check 6 only, word-for-word in the style of Check 3 (line 86) and Check 4 (line 109): a one-paragraph preamble naming the skill and saying "use its findings as the basis of this check — don't re-derive the rule by hand," followed by the "For reference, the rule the skill encodes:" recap of the ADR-item rule.
- **Preserve inline, unchanged:** the two non-ADR portions of Check 6 — scanning the developer hand-back "Surprises / decisions made" section, and scanning commit messages for surfaced-gap phrases ("surfaced", "flagged", "TODO", "follow-up", etc.). These are not ADR-specific and the skill does not cover them. Make explicit in the prose that the skill covers only the spec/tasks ADR-item slice; the Surprises + commit-message scans stay manual.
- Keep the existing "Finding / Severity / What to do" block and the "Why this check exists" paragraph (the HR5 anecdote at line 164). Update the Finding wording only if needed to point at the skill's orphaned-item output.
- The Check 6 entry in the "Passed checks" report template (line 214) is unchanged.

**Tests to write:** none (markdown agent descriptor).

**Manual verify:** none.

**Done when:**

- Check 6's ADR-item portion opens with a "Mechanical procedure: invoke the `adr-tracking-check` skill …" preamble matching Checks 3/4 phrasing.
- The Surprises-scan and commit-message-scan portions are still present and inline.
- Diff is confined to the Check 6 region of `.claude/agents/reviewer.md`; the agent's frontmatter `description` is unchanged unless a wording tweak is genuinely warranted (note: changing the description drifts the snapshot — Task 4 covers regen either way, but avoid gratuitous description edits).
- No new TypeScript errors.

---

### Task 3 — Planner rule: conditional "Pre-merge follow-ups" task

**Status:** Done (2026-06-03)

**Zone:** docs (harness)
**Depends on:** none
**Parallel-safe with:** Tasks 1, 2

**Files to add or change:**

- `.claude/agents/planner.md` — workflow step 4 / sizing-heuristics area, and the `tasks.md` template block.

**Shape:**

- **Rule (decision guidance):** when `spec.md` has a **non-empty** `## ADR-worthy decisions` section, the generated `tasks.md` MUST include a **final** task titled "Pre-merge follow-ups" whose **Done when** runs `adr-tracking-check <slug>` and requires **zero orphaned items**. Conditional emission only (alternative B's always-emit was rejected for "adapt don't bloat" — no no-op task on small plans). The planner already reads the full spec at workflow step 1, so detecting a non-empty section is free.
- Add this as a short bullet/paragraph in the **Workflow → Decompose (step 4)** heuristics list (alongside "Migrations are their own task") and reinforce it in the sizing-heuristics or a dedicated note.
- **Template:** show the conditional final-task block in the `## Tasks` template (a "Pre-merge follow-ups" task example whose Done-when runs the skill), and add a one-line note in the `## Open questions` guidance pointing at the same rule.
- Keep the rule terse; do not balloon the planner descriptor.

**Tests to write:** none (markdown agent descriptor).

**Manual verify:** none.

**Done when:**

- `.claude/agents/planner.md` instructs: non-empty `## ADR-worthy decisions` → append a final "Pre-merge follow-ups" task whose Done-when runs `adr-tracking-check` with zero orphaned items.
- The `tasks.md` template in the planner shows the conditional task.
- The rule states it is conditional (only when ADR items exist), not unconditional.
- No new TypeScript errors.

---

### Task 4 — Regenerate the harness-resolution snapshot (vitest gate)

**Status:** Done (2026-06-03)

**Zone:** docs (harness)
**Depends on:** Tasks 1, 2, 3 — **all three must be committed/landed first.**
**Parallel-safe with:** none — this is the synchronization point.

**Files to add or change:**

- `docs/conventions/harness-resolution.md` — **regenerated**, not hand-edited.

**Procedure:**

- Run `npm run audit:resolution` (invokes `node scripts/audit-resolution.mjs`, which writes the snapshot). This picks up the new `adr-tracking-check` skill row in the Skills table and any changed reviewer/planner descriptions. Do **not** edit the file by hand; do **not** import the `.mjs` anywhere (Vitest 4 on Windows rejects `.mjs` static imports from `.ts` — the script is run as a subprocess by the test, so just run the npm script).
- Then run `npm test` and confirm `resolution-snapshot.test.ts` passes (it re-derives the snapshot via `node scripts/audit-resolution.mjs --print` and diffs against the committed file).

**Tests to write:** none — the existing `resolution-snapshot.test.ts` *is* the gate.

**Manual verify:** none.

**Done when:**

- `npm run audit:resolution` regenerated `docs/conventions/harness-resolution.md` with the `adr-tracking-check` Skills row present.
- `npm test` is **green**, specifically `.claude/__tests__/references/resolution-snapshot.test.ts` passes.
- No new TypeScript errors.

---

### Task 5 — Pre-merge follow-ups (dogfood + skill validation)

**Status:** Done (2026-06-03)

**Zone:** docs (harness)
**Depends on:** Task 1 (skill must exist to run it); ideally after Task 4 so the whole harness is consistent.
**Parallel-safe with:** none — final gate.

This task exists *because of the rule this feature adds*: this spec's `## ADR-worthy decisions` section is non-empty, so per Task 3's new planner rule, the plan must carry a final "Pre-merge follow-ups" task. Running the new skill against our own spec is simultaneously the dogfood and the proof the skill works.

**The two ADR-worthy items in this spec (`spec.md` lines 122–128) and their tracking actions:**

1. **"Mechanical-check skills are the canonical home for each reviewer check's rule"** (the meta-pattern item). Architect's recommendation: **skip** unless the user wants the meta-pattern pinned — this is following established precedent (third instance after wire-shape/dark-mode), not a new hard-to-reverse decision. **Tracking action: explicit `Deferred:`.** Record a `Deferred:` line on this item (in this `tasks.md` or the PR body) with reasoning: "Following established precedent (3rd skill→check instance); not a new reversible decision. Pin only if the user wants the meta-pattern named once for posterity." This is the architect's recommended disposition.

2. **"The 'Pre-merge follow-ups' task is conditional, not unconditional"** (alternative B). Architect's recommendation: **worth a brief ADR** — it's a standing planner-behavior rule and future planners will want the rationale rather than re-deriving it. **Tracking action: write the ADR via `/create-adr`** (one short entry: "Pre-merge follow-ups task is conditionally emitted; rationale = adapt-don't-bloat, no no-op tasks on small plans"), OR open a linked follow-up issue if the user prefers to defer authoring. The developer surfaces this to the user and picks one before marking the task Done.

**Procedure:**

- Run `adr-tracking-check adr-tracking-enforcement` (slug form).
- For each item the skill reports as orphaned, apply its tracking action above: item 1 → ensure a `Deferred:` line exists; item 2 → ensure an ADR entry (or linked issue) exists.
- Re-run `adr-tracking-check adr-tracking-enforcement` until it reports **zero orphaned items**.

**Tests to write:** none.

**Manual verify:** none.

**Done when:**

- `adr-tracking-check adr-tracking-enforcement` reports **zero orphaned items** — both spec ADR-worthy items have exactly one tracking action (item 1 Deferred with reasoning; item 2 ADR-written or linked-issue).
- The skill's enumeration matches a hand audit of this spec's two ADR-worthy items (validation that parsing works).
- The tracking decisions are recorded in the PR body (per "surfaced gaps need tracking" memory): item 1 Deferred line, item 2 ADR/issue link.

## Sequencing notes

- **Tasks 1, 2, 3 are parallel-safe** — disjoint files (`.claude/skills/adr-tracking-check/SKILL.md` + `CLAUDE.md`; `.claude/agents/reviewer.md`; `.claude/agents/planner.md`). The user can run three developer dispatches concurrently if desired.
- **Task 4 is the synchronization point.** It must run only after 1, 2, 3 have landed, because the snapshot derives from the `.claude/` tree as a whole. Running it earlier produces a snapshot that the next edit immediately invalidates. After Task 4, `npm test` is green.
- **Task 5 needs the skill (Task 1) to exist** to run it. Sequence it after Task 4 so it validates against the final, consistent harness.
- **PR cut:** all five tasks form one logical change (the enforcement mechanism + its dogfood). Bundle into a single PR on the `agent/feat/...` branch. The PR body records the Task 5 tracking decisions and links the spec + this plan (per CLAUDE.md "ALWAYS record plan/spec link + agent ownership").
- **Expect a transient red snapshot test** between Task 1 and Task 4. That is by design — flag it in each hand-back so it isn't mistaken for a real failure.

## Open questions

No blocking open questions. The architect's two open questions are decided above (CLAUDE.md addition bundled into Task 1; stricter heading template kept out of scope). The two residual non-blocking items are the spec's own ADR-worthy decisions, both with assigned tracking actions in Task 5 (item 1 Deferred; item 2 ADR-or-issue) — the developer surfaces item 2's disposition (ADR vs. follow-up issue) to the user during Task 5 before marking it Done.
