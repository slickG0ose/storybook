# Archived agent definitions

These are zone-owner agent files retained for one stability window after the Harness Rebuild milestone. **Do not invoke them.** They are out of date with the current harness model.

## What's here

| File | Was | Replaced by |
|------|-----|-------------|
| `booksmith.md` | Server-zone specialist (`server/**` owner) | `developer.md` (full-stack) + `docs/conventions/server.md` (loaded on demand) |
| `storefront.md` | Client-zone specialist (`client/**` owner) | `developer.md` (full-stack) + `docs/conventions/client.md` (loaded on demand) |

## Why archive vs. delete

Per the HR10 ticket plan: move now, delete after one clean week. If a regression surfaces — a developer dispatch missing some convention the zone-owner used to enforce — we restore via `git mv` rather than `git revert` + replay.

After the stability window passes with no rollback signal, these files will be deleted outright (their full history remains in `git log --follow`).

## Why `qa.md` is NOT here

The QA agent stays alive — it owns Playwright e2e specs and test-infrastructure changes that don't fit the developer agent's "one task per dispatch" workflow. The developer reads `docs/conventions/testing.md` for unit-test patterns; net-new e2e specs and cross-zone test reviews remain `@qa`'s turf.

See `CLAUDE.md` "How work flows" for the current routing.

## When to delete this directory

Open a follow-up issue tagged `chore` to track the deletion checkpoint. Trigger conditions:

1. At least one **non-HR** feature has shipped end-to-end through the new chain
2. No reviewer / developer dispatch has surfaced a "would have been caught by the legacy agent" finding
3. One week minimum since the HR10 archive PR merged

If any of those fail, leave this directory alone and re-evaluate after the next clean window.
