---
description: Scaffold or refresh .code-captain/product/ — mission, roadmap, decisions log. Idempotent: never overwrites existing content.
argument-hint: (no arguments — runs a discovery loop)
---

Scaffold or refresh the product planning package at `.code-captain/product/`. Idempotent — if a file already exists with real content, this command will *augment* (proposing additions) rather than overwrite.

## When to use

- First time setting up `.code-captain/product/` on a new project
- After a substantial pivot — refresh the mission and add new roadmap phases
- Before kicking off a major feature track — confirm vision and constraints are written down
- **Not** for documenting a single decision (use `/create-adr` instead) or a single feature spec (use `/edit-spec`)

## Steps

### Phase 1 — Discovery (no files written)

1. **Read existing state.** Scan `.code-captain/product/` and load whatever's there. Specifically: `mission.md`, `roadmap.md`, `decisions.md`, plus any other `*.md` (the project may have its own conventions — preserve them).

2. **Summarize what's already captured.** One paragraph back to the user covering: product framing, current roadmap shape, decision log count. Make it clear what you already see so the user doesn't have to repeat it.

3. **Gather gaps.** Walk these dimensions and identify what's missing or stale. Ask **one focused question at a time** — don't checklist-dump:
   - Product vision: what is this, for whom, what value
   - Target users: who specifically has this problem
   - Differentiator: what makes this different from alternatives
   - Scope phase: MVP / Growth / Scale — what phase is current work
   - Constraints: timeline, single-dev vs team, paid-API budget, etc.
   - Success criteria: how do we know it's working

   **Challenge unclear or oversized ideas.** If scope sounds too large, suggest phasing. If target market is fuzzy, suggest narrowing. Better to surface concerns now than write the wrong plan.

4. **Propose a contract.** When you have high confidence, present a compact summary covering vision / users / value / current-phase scope / phase-2 hints / risks. Ask: "lock this in?" — wait for explicit yes.

### Phase 2 — File scaffolding (only after contract is locked)

5. **Write or update `mission.md`.** Use the template below. If `mission.md` already exists, *diff* against current content and propose changes — never overwrite without the user seeing the diff.

6. **Roadmap.** Same idempotent treatment for `roadmap.md`. If it already has substantial content (>1KB), do **not** rewrite — instead, add a phase or revise the current phase section explicitly, and show the diff.

7. **Decisions log.** Initialize `decisions.md` with the intro block and an "ADR-001 — Initial product planning" entry **only if the file is empty or missing**. If it exists with real entries, leave it alone — point the user at `/create-adr` for new decisions.

8. **Hand off.** Print the resulting file tree and a one-line summary of what changed. Recommend next steps:
   - `/create-adr` for any architectural decision worth recording
   - `/edit-spec <slug>` to detail a specific roadmap item
   - `/start-task` to begin implementing

## Templates

### `mission.md` (for empty or missing file)

```markdown
# Product Mission

> Status: <Planning | Building | Validating | Scaling>
> Last refreshed: YYYY-MM-DD

## Pitch

<One-sentence product framing: "X is a Y that helps Z do A by providing B.">

## Users

**Primary:** <segment, with their core problem>

**Secondary:** <if applicable, otherwise omit>

## The problem

<Concrete problem statement with quantifiable impact where possible.>

**Our solution:** <How this product specifically addresses it.>

## Differentiator

Unlike <existing alternatives>, we <specific advantage>. Result: <measurable benefit>.

## Current phase

<MVP | Growth | Scale> — <one-line scope marker for what's being built now>
```

### `roadmap.md` (for empty or missing file)

```markdown
# Roadmap

> Last refreshed: YYYY-MM-DD

## Phase 1 — MVP

**Goal:** <validate the core value proposition>
**Timeline:** <weeks or months>

- [ ] <feature> — <user value>
- [ ] <feature> — <user value>

## Phase 2 — Growth   <!-- (sketch — fill in once Phase 1 is shipping) -->

- <placeholder feature 1>
- <placeholder feature 2>

## Phase 3 — Scale   <!-- (placeholder) -->

- <advanced capabilities, when applicable>
```

### `decisions.md` (for empty or missing file)

```markdown
# Product & Technical Decisions Log

Append-only log. Newest entries on top. Each entry should answer: *what was decided, when, why, and what we considered instead.*

---

## ADR-001 — Initial product planning

**Date:** YYYY-MM-DD
**Status:** Accepted

### Decision

<Summarize: vision, target users, current-phase scope.>

### Why

- <driver 1>
- <driver 2>

### Alternative considered: <name>

<Brief description and why rejected.>
```

## Constraints

- **Never overwrite a populated file without diff approval.** This command is idempotent — existing real content is sacred.
- **No `mission-lite.md`.** Upstream code-captain produces this as an "AI context optimization" — for a solo / small project the redundancy isn't worth it. Use full `mission.md`.
- **Don't auto-create `.code-captain/research/` or `decision-records/`.** Our convention is single-file `decisions.md` plus ad-hoc `docs/*.md`. Stay aligned.
- **Match existing tone.** If the repo already uses terse, code-sample-heavy ADRs, the generated content should too. Read existing entries and mirror.
- **One question at a time** in discovery. Don't dump a survey.
