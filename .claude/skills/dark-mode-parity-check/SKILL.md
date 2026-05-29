---
name: dark-mode-parity-check
mode: agent
description: Given a list of changed client/** files (or a diff), grep for new className strings that introduce visual surfaces and verify each has a matching dark: variant. Heuristic but catches the #1 source of UI regression bugs in this project.
argument-hint: "[<file-paths>...]  (omit to default to git diff master...HEAD client/)"
---

# dark-mode-parity-check

The mechanical procedure for **reviewer Check 3 — Dark-mode parity**. Given changed client files, this skill answers a single question: *does every newly-introduced visual class have a `dark:` partner?*

This skill exists because the dark-mode parity rule is `docs/conventions/client.md`'s load-bearing UI rule and the #1 source of UI regression bugs. Catching misses mechanically is cheaper than discovering them in the browser.

## When to invoke

- **Reviewer agent**, Check 3, whenever the diff touches `client/**/*.{tsx,css}`.
- **Developer agent**, before marking a client task `Done`, as self-check.
- **Ad-hoc**, when you've changed UI and want a sanity check before opening a PR.

Skip this skill when the diff has no `client/**` changes — there's nothing to check.

## Inputs

- Either a list of file paths (`client/src/pages/Foo.tsx client/src/components/Bar.tsx`), or
- No argument — in which case default to `git diff master...HEAD -- 'client/**/*.tsx' 'client/**/*.css'`.

The skill operates on the **diff**, not the full file. A class that exists today without a `dark:` variant is pre-existing tech debt, not something this PR introduced. Flagging it on every PR would be noise. The rule: only flag classes *added in this diff*.

## Procedure

### Step 1 — Collect the added lines

```bash
git diff master...HEAD --unified=0 -- '<client paths>' | grep -E '^\+[^+]'
```

The `^\+[^+]` filter excludes the `+++ b/file` headers and only keeps lines actually added in the diff. Save these to work against.

### Step 2 — Extract className strings from added lines

For every added line, extract anything between `className="..."` or `class="..."` (CSS files). Use this pattern (ripgrep / grep):

```
className=["'`]([^"'`]+)["'`]
```

For lines using template-literal classNames (e.g. `className={\`bg-white ${cond ? 'p-4' : 'p-2'}\`}`), extract the literal parts but skip the interpolated `${...}` segments — they're dynamic and the check can't reason about them without execution. Note any skipped expressions in the report so the human knows to eyeball them.

### Step 3 — Filter to visual classes

Tailwind utilities split into "visual" (renders something a user can perceive) and "layout/structural" (no visual effect on its own). Only visual classes need `dark:` partners.

**Visual class prefixes (require a `dark:` partner):**

- Background: `bg-`
- Text color: `text-` (except `text-xs/sm/base/lg/xl/...` which are font-size, not color)
- Border color: `border-` followed by a color token (not `border-2`, `border-t`, etc.)
- Ring / outline: `ring-` (color form), `outline-` (color form)
- Divide: `divide-` followed by a color token
- Placeholder: `placeholder-`
- Shadow: `shadow-` if it includes a color variant; bare `shadow-md` etc. is treated as visual-but-low-priority — flag at Low severity, not High.

**Stateful visual classes (`hover:`, `focus:`, `active:`, `disabled:`, `group-hover:`, etc.):** if the stateful class is visual, its dark partner is `dark:hover:...` (the `dark:` always wraps the state). Treat these the same as base classes.

**Layout / structural classes (DO NOT require a `dark:` partner):**

- Spacing: `p-`, `m-`, `gap-`, `space-`
- Sizing: `w-`, `h-`, `min-`, `max-`, `size-`
- Display: `flex`, `grid`, `block`, `inline`, `hidden`, `table`
- Position: `relative`, `absolute`, `fixed`, `sticky`, `top-`, `inset-`, `z-`
- Typography size/weight: `text-xs/sm/base/lg/xl/2xl/...`, `font-bold/medium/normal`, `leading-`, `tracking-`, `whitespace-`
- Border *width* and *style* (not color): `border-2`, `border-t`, `border-dashed`, `rounded-*`
- Transitions/animations: `transition`, `duration-`, `ease-`, `animate-`
- Cursor / pointer: `cursor-`, `pointer-events-`
- Overflow: `overflow-`, `truncate`

When in doubt, ask: *would toggling dark mode change how this class renders?* If yes, it's visual. If no, skip it.

### Step 4 — Check for `dark:` partner per visual class

For each visual class `X-Y` (e.g. `bg-white`), look in the **same className string** (same line in the diff) for a class matching `dark:X-*`. If absent, that's a finding.

**Don't require the partner to be the inverse hue.** `bg-white dark:bg-slate-900` is the canonical pattern, but `bg-white dark:bg-slate-800` is also fine — the skill only checks for *presence* of a dark variant, not its appropriateness. Appropriateness is an architect / human-design judgment.

**Co-located in the same className string is the standard.** If the `dark:` partner is in a different file or a different element, that's not parity for *this* element.

### Step 5 — Report per finding

For each visual class without a dark partner:

> **Finding: dark-mode parity — `<file>:<line>`.** Class `<className>` introduced without a `dark:` partner. Likely visual: <bg | text | border | ring | shadow | placeholder | …>.
> **Severity:** Medium-High (per `docs/conventions/client.md`, #1 UI regression source).
> **What to do:** add a `dark:` variant on the same element, then manually verify in browser in both modes.

Group findings by file when the same file has many — the reviewer's job is signal not noise:

> **Finding: dark-mode parity — `<file>` (N classes missing).** Lines `<L1, L2, …>`. Classes: `<class1>`, `<class2>`, …

## Heuristic limits — be explicit about them

This skill is a **heuristic**, not a proof. The places it can miss or false-positive:

1. **Dynamic classNames.** `className={`bg-${color}`}` cannot be checked statically. The skill should report these as `<skipped — dynamic>` so the human knows.
2. **Class composition via `clsx` / `tw-merge`.** The skill should detect `clsx(...)` calls and try to extract literal classes, but conditional branches inside `clsx` may hide a `dark:` partner the skill misses.
3. **Tailwind variants applied via `@apply` in CSS files.** If a `.css` change adds `@apply bg-white;`, the skill should flag it the same way as a `className` change.
4. **The exceptions list is not exhaustive.** New Tailwind utilities or custom variants may need additions to Step 3's lists. If the skill sees an unrecognized class, default to "treat as visual" (false positive over false negative is the safer side).

When in doubt, flag with Low severity and let the human decide. Don't suppress findings to look clean.

## Output format

```
# dark-mode-parity-check — <N files inspected>

**Source:** <"git diff master...HEAD" | "files provided">
**Added classNames extracted:** <N>
**Visual classes:** <N>
**Layout/structural (skipped):** <N>
**Dynamic / skipped:** <N>

## Findings

<one block per file, using the templates above>

## Passed

<files inspected with no findings, one line each>

## Notes

<heuristic-limit caveats: dynamic strings encountered, unrecognized classes, etc.>
```

A clean run is one paragraph. A failing run names every offending class with its file:line.

## What this skill does NOT do

- It does **not** open the browser. Manual verification in both modes is still required by `CLAUDE.md` done criteria — this skill only catches *static* misses, not visual regressions a human eye would catch.
- It does **not** judge whether the `dark:` color choice is *appropriate*. `bg-white dark:bg-white` would pass syntactically; design appropriateness is the human's call.
- It does **not** modify any file. Findings go to the report, not the diff.

## Related

- `.claude/agents/reviewer.md` — Check 3 (this skill is the mechanical implementation).
- `docs/conventions/client.md` — "Dark mode parity (LOAD-BEARING)" section.
- `CLAUDE.md` — done criteria require manual verification in both modes after this skill passes.
