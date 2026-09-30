# MVP alpha plan — friends & family

> Written 2026-09-30. Product reason: [#157](https://github.com/slickG0ose/storybook/issues/157).
> Print pipeline is out of scope by Nick's call.

## Where things stand (verified 2026-09-30)

| Thing | State | How it was checked |
|---|---|---|
| Neon DB (`storybook`, `winter-hall-49187726`, `aws-us-west-2`) | **Restored.** 10 tables, 2 users, 7 books, 35 pages, 2 allowlist rows. Newest book 2026-09-03 — the dump was taken before Render deleted the old DB. | Neon MCP, `SELECT count(*)` |
| Render server | **Up, but broken.** `/api/health` → 200, `/api/books` → 500. Runbook Step 6 (point `DATABASE_URL` at Neon) has not been done. | `curl` |
| Client (GitHub Pages) | Not re-checked; last verified up 2026-09-03. | — |
| Illustration bytes | **Still lost on every Render restart.** Rows survive, PNGs don't. | Spec: `.code-captain/specs/blob-storage-r2/spec.md` |
| Deploy schema step | `prisma db push --accept-data-loss` on every deploy. | `render.yaml:48` |

## Must-have before the first tester invite

Owner in brackets. Times are hands-on, not wall clock.

1. **[Nick, 15 min] Cut Render over to Neon.** Runbook Steps 6–7 in
   `docs/neon-migration-runbook.md`. Then merge
   [PR #185 — Neon migration runbook + durable DATABASE_URL](https://github.com/slickG0ose/storybook/pull/185)
   so a Blueprint sync can't point production back at the deleted DB. Done when
   `/api/books` returns the demo books.
2. **[Nick, 15 min] Rule on ADR-025 to ADR-028** in `.code-captain/product/decisions.md:7-136`
   — flip each `Status:` to Accepted or leave a note. ADR-027 is the one needing a real
   yes: new runtime dependency (`@aws-sdk/client-s3`) and a new external service (R2).
3. **[Agents, ~1 day of dispatches] Durable illustrations — R2 Scope B, Tasks 2–7.**
   `.code-captain/specs/blob-storage-r2/tasks.md`. Blocked only on step 2. ADRs:
   ADR-025 (seam), ADR-026 (redirect), ADR-027 (R2 + SDK). Then **[Nick, 20 min]** create
   the R2 bucket, enable `r2.dev`, create an API token, set the vars in Render.
4. **[Agents, ~half a day; Nick, 10 min] `migrate deploy` instead of `db push --accept-data-loss`.**
   ADR-028. Needs an architect spec first (touches deploy + Prisma layout). Nick runs the
   one-time baseline (`migrate resolve --applied 0_init`) against Neon from the runbook.
5. **[Nick, 10 min] Keys and caps in Render.** [#62 — FAL_KEY not set in Render](https://github.com/slickG0ose/storybook/issues/62)
   is still open, so illustration generation likely 501s — confirm the value, not just the
   key. Then raise the daily cap: at the default `QUOTA_DAILY_PER_USER_CENTS=50`, a
   5-page book costs ~30¢ (story 6¢ + 5 × 4¢ + cover 4¢) but a 15-page book costs ~70¢, so
   **a tester can't finish one long illustrated book in a day.** Suggest `150`. At
   `QUOTA_MONTHLY_GLOBAL_CENTS=2000` everyone together gets 30–65 books a month.

Suggested order: 1 → 2 → (3 and 4 in parallel worktrees — they share only `render.yaml`) → 5 → invite.

## Decisions Nick owes (from #157's open questions)

- **Tester logins.** Recommendation: the existing allowlist, no new auth — add each email
  in the admin UI, they register normally. Zero code. Anything more ephemeral touches the
  auth guardrail.
- **Feedback channel.** Recommendation: out-of-band — a Google Form linked from the site
  footer. ~1 hour of agent work for the link. An in-app widget is a spec's worth of work.
- **Placeholder prices.** Checkout takes no real payment, so this is copy, not money.
  Pick a number or hide prices for the alpha.

## After the alpha starts (not blocking)

- [#174 — case-insensitive unique index on User.email](https://github.com/slickG0ose/storybook/issues/174) — first real migration once step 4 lands.
- [#95 — version restore orphans every illustration](https://github.com/slickG0ose/storybook/issues/95) — a real bug in a base feature; next in line if testers use restore.
- [#117 — footer has no privacy or terms links](https://github.com/slickG0ose/storybook/issues/117) — pair with the feedback link.
- Custom domain in front of R2, replacing rate-limited `r2.dev` (ADR-026) — only if testers hit the limit.
- [#97 — flaky server suite](https://github.com/slickG0ose/storybook/issues/97), [#68 — legacy sha256 password removal](https://github.com/slickG0ose/storybook/issues/68).
