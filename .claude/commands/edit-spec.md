---
description: Modify an existing feature spec at .code-captain/specs/<slug>/spec.md. Confirms intent and shows a diff before writing.
argument-hint: <spec-slug> (e.g., "subscription-tier", "pdf-export") — or omit to list available specs
---

Edit an existing spec at `.code-captain/specs/<slug>/spec.md`. Contract-first: clarify the change, show a diff, get approval, then write.

## When to use

- Modifying scope, requirements, or acceptance criteria on an in-flight spec
- Reconciling a spec with new constraints surfaced during implementation
- Capturing decisions made during a feature that weren't in the original spec
- **Not** for creating a new spec (that's `/create-spec`, not yet installed)
- **Not** for documenting a single architectural decision (that's `/create-adr`)

## Steps

### Phase 1 — Locate and load (no writes)

1. **Resolve the spec.** Three paths:
   - Argument matches `.code-captain/specs/<slug>/` exactly → load `<slug>/spec.md`
   - Argument is partial (e.g. just "subscription") → grep `specs/*/spec.md` titles and folder names, present matches for user disambiguation
   - No argument → list every `specs/*/spec.md` with its title and last-modified date, ask the user which to edit
   - **If `.code-captain/specs/` doesn't exist:** report "no specs to edit yet — run `/create-spec` first" and stop. Do not create the directory.

2. **Load current state.** Read the spec.md and report a one-paragraph summary back: title, scope as currently written, status if marked. Make it clear what you're starting from.

3. **Scan for in-flight implementation.** Grep the codebase for any files referencing the spec slug or its key terms — gives you (and the user) signal on what's already built. Not authoritative, just a heads-up.

### Phase 2 — Clarify the change (no writes)

4. **Ask focused questions.** What's changing? Why? Is this expanding scope, narrowing scope, or refining acceptance criteria? **One question at a time.** Watch for:
   - **Breaking changes** — does the change invalidate existing implementation?
   - **Scope creep** — is the change inside the original intent or expanding it?
   - **Dependency impact** — does the change touch other specs / decisions?

   Push back if any answer feels off. Better to challenge now than write a wrong update.

5. **Present a modification contract.** Compact summary with these sections:

   ```
   ## Proposed change to spec: <slug>

   **Change type:** Addition | Removal | Refinement | Refactor
   **Driver:** <one sentence why>

   **What changes in spec.md:**
   - <bullet of what gets added/removed/edited>

   **Impact on existing implementation:** <none | minor edits | rework needed>
   **Out-of-scope (still not in this spec):** <reaffirm what remains excluded>

   **Risks:**
   - <any technical or scope risks>
   ```

   Ask explicitly: "lock this in?" — wait for yes.

### Phase 3 — Apply (only after contract is locked)

6. **Show the diff.** Generate the proposed edit to `spec.md` and display it to the user as a unified diff (or as before/after blocks for any section being rewritten). Wait for confirmation.

7. **Write the file.** Use `Edit` for targeted changes, `Write` only if rewriting the whole spec. Preserve formatting and section ordering.

8. **Update the spec's "Last modified" line** if one exists (or add one at the top: `> Last modified: YYYY-MM-DD — <one-line change summary>`).

9. **Hand off.** Print:
   - The path of the file that was changed
   - A one-line summary of what changed
   - If the change implies code work, suggest `/start-task` or referencing the spec in the next branch

## Constraints

- **Single file only.** This command edits `spec.md` and nothing else. No `user-stories/`, no `sub-specs/`, no auto-backups, no `CHANGELOG.md` — those are upstream code-captain conventions we don't follow. Git history is the audit trail.
- **No silent overwrites.** Always show the diff before writing. The user controls when the file changes.
- **No `git add` / `git commit` from this command.** User-driven only.
- **If multiple specs match the argument, never guess.** Always disambiguate explicitly.
- **Match the existing spec's tone and structure.** If the spec uses checklists, keep them. If it uses prose, stay in prose.
