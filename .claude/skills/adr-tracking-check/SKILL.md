---
name: adr-tracking-check
mode: agent
description: Given a spec slug (or explicit spec.md + tasks.md paths), enumerate every ADR-worthy item and verify each has exactly one tracking action — a matching ADR in decisions.md, a linked follow-up issue, or an explicit Deferred: line. Reports orphaned items. Read-only; the mechanical procedure for the ADR-item slice of reviewer Check 6.
argument-hint: "<spec-slug>  (or: <spec.md-path> <tasks.md-path>)"
---

# adr-tracking-check

The mechanical procedure for the **ADR-item slice of reviewer Check 6 — Surfaced-gaps follow-through**. Given a spec, this skill answers a single question: *does every ADR-worthy item declared in `spec.md` and `tasks.md` have exactly one tracking action?*

This skill exists so the reviewer agent (and the developer, as a self-check during a "Pre-merge follow-ups" task) don't re-derive the rule each time. The rule is mechanical — encode it once, run it every PR. It implements the ADR-item portion of Check 6 the same way `wire-shape-check` implements Check 4 and `dark-mode-parity-check` implements Check 3.

## When to invoke

- **Reviewer agent**, Check 6, for the spec under review — the ADR-item portion only.
- **Developer agent**, executing a "Pre-merge follow-ups" task, before marking it `Done`, as self-check.
- **Ad-hoc**, when you want to confirm a spec's ADR-worthy items are all tracked before opening a PR.

This skill covers only the spec/tasks ADR-item slice of Check 6. The developer-hand-back "Surprises" scan and the commit-message phrase scan are **not** covered here — they stay inline in the reviewer.

## Inputs

Accept **either**:

- `<spec-slug>` — resolve to `.code-captain/specs/<slug>/spec.md` and `.code-captain/specs/<slug>/tasks.md`, **or**
- two explicit paths — `<spec.md-path> <tasks.md-path>`.

The slug form is the default; it maps to the canonical paths above. If a path doesn't resolve (slug has no spec dir, or an explicit path is missing), stop and report the misuse — don't try to be clever.

## Procedure

### Step 1 — Enumerate ADR-worthy items

Collect candidate items from both files:

- **`spec.md`** — items under the `## ADR-worthy decisions` heading. Items are checkbox bullets: `- [ ] **<decision>** — <reasoning>`.
- **`tasks.md`** — items under **any** heading containing "ADR-worthy" or "Open questions" (case-insensitive). The architect's task template uses `## Open questions`; theater-mode used `## ADR-worthy items beyond the spec's existing 5`. Tolerate both. Treat `- ` and `- [ ]` bullets under such a heading as candidate items.

Record each item's short title (the bolded `**<decision>**` text, or the first clause of the bullet). If a bullet can't be parsed into an item, **do not drop it silently** — record it as `<unparseable — review by hand>` and surface it in the report.

If neither file has any ADR-worthy section, the check is a clean no-op — say so and stop.

### Step 2 — For each item, find exactly one tracking action

Read `.code-captain/product/decisions.md` once. Then for each item, look for the first match among:

- **Matching ADR** — an entry `## ADR-NNN — <title>` in `decisions.md`. **Primary signal:** the ADR's title or its `**Scope:**` line references the spec slug or the decision's subject. One ADR may bundle several decisions under one entry (e.g. ADR-004 bundles all the theater-mode items) — count a bundling ADR as covering each item it bundles.
- **Linked follow-up issue** — a GitHub issue reference near the item (`#NN`, `Follow-up: #NN`). Note the reference; you need not call `gh` unless an explicit path/check is requested.
- **Explicit `Deferred:`** — a `Deferred:` annotation on the item with reasoning (also accept `**Judgment:** … skip`/`… defer`). The reasoning text is what distinguishes a real defer from a dropped item.

**Fuzzy matches:** when an ADR plausibly but not verbatim covers an item, report `<possible match — confirm>` rather than asserting tracked or orphaned. The human confirms ambiguous matches. Don't assert false confidence either way.

### Step 3 — Report

Classify each item:

- **Tracked** — exactly one tracking action found (ADR / linked issue / Deferred line).
- **Orphaned** — no tracking action found. This is a finding.
- **`<possible match — confirm>`** — a fuzzy ADR match; needs human confirmation.
- **`<unparseable — review by hand>`** — a bullet that couldn't be parsed.

For each orphaned item, report:

> **Finding: adr-tracking — `<item title>`.** ADR-worthy item in `<spec.md | tasks.md>` has no tracking action: no matching ADR in `decisions.md`, no linked follow-up issue, no `Deferred:` line.
> **Severity:** Medium (per reviewer Check 6).
> **What to do:** the human (or a developer dispatch) picks one — write the ADR (`/create-adr`), open and link a follow-up issue, or add a `Deferred:` line with reasoning. Then re-run this skill.

For tracked items, say so in one line each (item → tracking action).

## Heuristic limits — be explicit about them

This skill is a **heuristic**, not a proof. Where it can miss or false-positive:

1. **Heading drift.** It greps known heading patterns (`## ADR-worthy decisions`, any heading containing "ADR-worthy" or "Open questions"). A spec using an unrecognized heading will under-enumerate — note the headings actually found so the human can spot a missing section.
2. **Fuzzy ADR matching.** "Matching ADR" is keyed on the slug/subject appearing in the ADR title or `**Scope:**` line. An ADR that covers an item without naming it verbatim surfaces as `<possible match — confirm>`, not as tracked.
3. **Bundled ADRs.** One ADR covering many decisions is counted as covering each — but if the bundle silently omits one of the spec's items, the skill can't tell. When an ADR clearly maps to *some but not all* of a spec's items, flag the remainder rather than assuming the bundle is exhaustive.
4. **Issue links not verified.** A `#NN` reference is taken at face value; the skill does not confirm the issue exists or is open unless asked.

When in doubt, prefer `<possible match — confirm>` over asserting tracked. Don't suppress items to look clean.

## Output format

Always hand back a structured report, even when everything passes:

```
# adr-tracking-check — <spec slug or paths>

**spec.md:** <path>  (<N items>)
**tasks.md:** <path>  (<N items>)
**Headings found:** <list of ADR-worthy/Open-questions headings actually matched>

## Findings (orphaned)

<one block per orphaned item, using the template above>

## Tracked

<each tracked item, one line: item → ADR-NNN | issue #NN | Deferred>

## Needs confirmation

<each <possible match — confirm> and <unparseable — review by hand> item>
```

A clean run is one paragraph ("N items, all tracked"). A failing run names every orphaned item.

## What this skill does NOT do

- It is **read-only.** It does **not** author ADRs (no `/create-adr` invocation, no change to that command), does **not** open or close GitHub issues, does **not** write `Deferred:` lines, and does **not** modify `spec.md`, `tasks.md`, `decisions.md`, or any other file. It reports orphaned items; the human (or a developer dispatch) picks the tracking action.
- It does **not** cover the non-ADR portions of Check 6 — the developer-hand-back "Surprises" scan and the commit-message phrase scan stay inline in the reviewer.
- It does **not** judge whether a tracked item's ADR or defer reasoning is *good* — only that exactly one tracking action is present. Disposition quality is a human/architect call.

## Related

- `.claude/agents/reviewer.md` — Check 6 (this skill is the mechanical implementation of its ADR-item slice).
- `.claude/agents/architect.md` — emits a "Pre-merge follow-ups" task whose Done-when runs this skill when a spec has ADR-worthy items.
- `.code-captain/product/decisions.md` — the ADR log this skill reads.
- `feedback_surfaced-gaps-tracking` (user memory) — the policy this operationalizes: every surfaced gap needs one tracking action.
