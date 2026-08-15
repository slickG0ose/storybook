---
description: Append a new ADR to .code-captain/product/decisions.md — capture an architectural decision with rationale, alternatives, and consequences
argument-hint: [topic-or-backlog-id] (e.g., "OPS.3 zod source of truth", "use sqlite over postgres")
---

Append a new ADR entry to `.code-captain/product/decisions.md` (newest-on-top), matching the existing ADR-001 / ADR-002 style.

## When to use

- Documenting an architectural decision with non-obvious trade-offs (stack choice, schema shape, integration boundary, deferred upgrade path)
- Capturing a decision retroactively when the reasoning lives in conversation but isn't in the repo
- **Not** for routine choices a code review would catch (variable naming, file layout)

## Steps

1. **Locate `decisions.md`.** Path is `.code-captain/product/decisions.md`. If it doesn't exist, abort and say so — the product directory needs scaffolding before an ADR can be appended.

2. **Determine the next ADR number.** Read `decisions.md`, grep for `## ADR-NNN`, take the highest existing number and add 1. Use 3-digit zero-padding (`ADR-003`, not `ADR-3`).

3. **Gather decision context.** Look at the argument and current conversation for what's being decided. Three context paths in priority order:
   - If the argument matches a known backlog ID (e.g. `OPS.3`), search `docs/backlog.md` and any other in-repo docs for the existing decision notes — usually the rationale already exists, you're just formalizing it
   - If `.code-captain/research/<slug>.md` exists for this topic, read it
   - Otherwise, ask the user 2-4 focused questions to surface: the decision, the why, the alternatives considered, the consequences. **One question at a time.** Don't dump a checklist.

4. **Draft the ADR.** Use the template below. Keep it terse and match the existing ADR style — concrete language, no corporate filler, code samples where they clarify.

5. **Insert at the top of the ADR list.** Open `decisions.md` and place the new block immediately after the intro lines but **above** the existing newest ADR. The structural marker is the first `## ADR-` heading — insert before it. Preserve the `---` separator between entries.

6. **Show the user the rendered ADR** and ask whether to commit it. Do not `git add` or `git commit` from this command — the user controls that.

## ADR template

Use this skeleton. Sections marked *(optional)* may be omitted when not applicable.

```markdown
## ADR-NNN — <one-line title>

**Date:** YYYY-MM-DD
**Status:** Accepted   <!-- or Proposed / Deprecated / Superseded by ADR-XXX -->
**Scope:** <optional one-line scope marker, e.g. "MVP-1 of illustration upgrade" or omit>

### Decision

<1-3 paragraphs stating what was decided. Concrete and active voice. Include shape/code/path examples if they make the decision unambiguous.>

### Why

- **<driver 1>** — <one-sentence rationale>
- **<driver 2>** — <one-sentence rationale>
- **<driver 3>** — <one-sentence rationale>

### Alternative considered: <name>

<Brief description of the alternative.>

<Why it was rejected, or what would have to change for us to revisit. Keep it honest — list real trade-offs, not strawmen.>

### Consequences   <!-- (optional) -->

- **<consequence 1>** — <implication or follow-up>
- **<consequence 2>** — <implication or follow-up>
```

## Constraints

- **Append-only mental model.** Existing ADRs are not edited (except their `**Status:**` line when superseded). To change a decision, write a new ADR that supersedes the old one.
- **Newest on top.** New entries go *above* existing ones, after the intro but before the first `## ADR-` heading.
- **No file-per-ADR.** Everything lives in the single `decisions.md`. This is intentional — keeps git history readable and lets `grep` find decisions in one pass.
- **Match local style.** ADR-001 and ADR-002 are the reference. If the template starts to feel verbose, trim — ADRs are signal, not ceremony.
- **No auto-commits.** Always hand the rendered ADR back for user review.
