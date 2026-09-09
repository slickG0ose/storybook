### agent/fix/age-range-vocabulary — 2026-09-09

**Issue:** #172 — age_range vocabulary diverges between CreateBook.tsx and seed.ts, and nothing validates it
**Spec:** .code-captain/specs/age-range-vocabulary/spec.md (to be drafted by @architect)

**Ruling from the user (2026-09-09):** the **seed list wins** — `2-5`, `3-6`, `4-7`, `4-8`, `5-9`
is the canonical vocabulary. `CreateBook.tsx`'s `2-4` and `6-10` are dropped.

**Plan**
- [ ] Architect: spec + tasks.md
- [ ] Canonical Zod enum in `@storybook/shared`
- [ ] Point `CreateBook.tsx:26` AGE_RANGES at the shared enum
- [ ] `validate()` on `POST /api/generate` (server/src/routes/generate.ts:121 currently checks truthiness only)
- [ ] Migrate existing rows off `2-4` / `6-10` (guardrail — needs confirmation before running)

**Open questions for the architect**
- Migration mapping for any live rows on `2-4` / `6-10` (`2-4`→`2-5`? `6-10`→`5-9`?), and whether
  prod has any such rows at all.
- #113's `independent` typography bucket needs a lower bound ≥ 8. The seed vocabulary tops out at
  `5-9`, so that bucket stays unreachable. In scope here, or explicitly deferred?
