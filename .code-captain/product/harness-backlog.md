# Harness Backlog — Upstream Code Captain v0.6.0

> **Historical (2026-05-15). Superseded 2026-08-15.** This ranked what to
> adopt from upstream. Most Tier 1/2 items were adopted, then removed again
> in the harness simplification — the generic skills (`swab`,
> `analyze-repos`, `explain-code`, `research`, `mcp-analysis`) are gone
> because current-gen models cover that ground natively, which the Tier 2
> notes below already half-predicted. Other details here have gone stale:
> the repo *is* on GitHub now, and the `booksmith`/`storefront` agents were
> retired in #55. Kept for the reasoning, not as a live plan.

Long-term work to evaluate after the 2026-05-15 demo. None of this is blocking.

**Upstream reference:** [devobsessed/code-captain @ main](https://github.com/devobsessed/code-captain/tree/main/claude-code) (PR #27 merged 2026-05-14, ~2 hours before this entry).

## Why this exists

Our local `.claude/` has custom agents only (booksmith, qa, storefront). The upstream template diverged early and has since grown a substantial commands+skills library. This file captures what's worth pulling in, ranked by likely value to our actual workflow — not by upstream's emphasis.

## Ranked candidates

### Tier 1 — likely worth adopting

| Item | Type | Why we'd want it |
|---|---|---|
| `plan-product` | command | Formalizes what we did ad-hoc with the MVP roadmap. Writes to `.code-captain/product/{mission,roadmap,decisions}.md` — convention we've already started following manually. |
| `create-adr` | command | We hand-rolled ADR-002 in [decisions.md](decisions.md). A real `/create-adr` command would standardize this. |
| `status` | skill | Built for context-switching between sessions. We hit this exact need today when running parallel CLI sessions on the same project. |
| `edit-spec` | command | Companion to `plan-product` / `create-spec`. Lets the roadmap evolve without rewriting it from scratch. |

### Tier 2 — situational

| Item | Type | When to revisit |
|---|---|---|
| `execute-task` | command | Could replace our TodoWrite-driven MVP execution. Worth evaluating once we have a second feature to plan. |
| `swab` | skill | Boy Scout Rule cleanup, one tiny safe change at a time. Nice to have for the slow-growing tech-debt list. |
| `analyze-repos` | skill | Generic codebase analysis. Already approximated by Explore agent. |
| `explain-code` | skill | Onboarding aid. Useful when bringing someone new onto the storybook codebase. |
| `research` | skill | Generic. Already approximated by general-purpose agent. |

### Tier 3 — skip or defer indefinitely

| Item | Why skip |
|---|---|
| `.mcp.json` (Atlassian + GitHub) | We use Azure DevOps at AGP and the storybook repo isn't on GitHub. Reconfigure if/when those change. |
| `mcp-analysis` skill | Only relevant once we have MCP servers worth auditing. Not today. |
| Generic agents (code-captain, spec-generator, story-creator, tech-spec) | Would conflict with or duplicate our project-specific agents (booksmith, qa, storefront). |
| `new-command` | Meta-tooling for authoring commands. Useful once we have a reason to author one. |

## Adjacent infrastructure follow-ups (not Code Captain, but in the same neighborhood)

| Item | Why | Notes |
|---|---|---|
| **Cloud hosting for `develop` and `master`** | Currently everything is localhost. Want a persistent URL for `develop` (staging) and `master` (prod-ish demo) so the app can be shared without running `npm run dev` on someone's laptop. | Recommended path: Vercel for the client + Railway/Fly.io for the Express + SQLite server (Vercel functions don't suit SQLite well). Both have free / cheap tiers and per-branch auto-deploy. Defer until after the 2026-05-15 demo. |

## Suggested install path (post-demo)

1. **Don't run `npx @devobsessed/code-captain` directly.** It would install the full kit and likely conflict with the existing `.claude/agents/`. Pick what we want by hand.
2. Copy only the Tier 1 files into `.claude/commands/` and `.claude/skills/` from the upstream `claude-code/` directory.
3. Test each in isolation before adopting.
4. Update this file with adoption status as items move from "candidate" to "in use" or "rejected after trial".

## Repos that have the same gap

`C:\repos\source\AGP\.claude\` is also missing most of the upstream commands+skills. It has only `agp-orchestrator` + `pr-reviewer` agents, one `agp-feature` command, one `azure-devops-cli` skill. Same Tier 1/2/3 analysis applies; do not auto-install there either.
