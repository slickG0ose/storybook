# PR-body notes — generated-narration (#156)

Draft material for `/ship`. Spec: `.code-captain/specs/generated-narration/spec.md`. Plan: `.code-captain/specs/generated-narration/tasks.md`. Decisions: ADR-033, ADR-034 and ADR-035 in `.code-captain/product/decisions.md`, plus an amendment note on ADR-011 and a Scope note on ADR-025.

## Manual obligations (CI cannot discharge these)

No test calls fal. Green tests prove the wiring, not that Kokoro is called correctly or sounds right.

1. **One real generation with a real `FAL_KEY`.** Sign in, press Play on an uncached page, and confirm that:
   - a `NarrationClip` row exists;
   - one `UsageLog` row exists with `kind = 'narration'`;
   - the WAVs exist under `<bookId>/narration/`;
   - a replay writes no new `UsageLog` row.

   **Also read the fal dashboard's billed amount for the sentence-by-sentence sample.** This is still unverified. If fal rounds each request up to 1K characters, change `narrationCostCents` in `server/src/services/spend.ts` to `segments × 2¢` before merge (see ADR-034 Consequences).
2. **One desktop Chrome listen.** `af_heart` should be audible within a few seconds of the first Play. The sentence highlight should stay in step. Auto-advance should run through the book without a stall on cached or prefetched pages. Check the gap between sentences.
3. **One iPhone listen, covering the first-Play gesture prime.** On a cold (uncached) page, the first Play should start audio after the network wait, with no "Tap play to continue". That confirms the silent-WAV prime unlocks the element. Auto-advanced pages should also play without another tap.

## Decisions made during implementation (one line each)

- **Task 4:** the fal download accepts only `https` on `fal.media` / `*.fal.media`. It has `redirect: 'error'`, a 5 MB streaming cap and a 60 s timeout, and the key is redacted from vendor errors.
- **Task 4:** live check 2026-11-08 (one "Hi." call). Audio came from `v3b.fal.media` with a 200 `audio/wav` and no redirect, which matches the allowlist.
- **Task 4:** `isNarrationConfigured()` returns false, rather than throwing, on an invalid `STORAGE_BACKEND`. There is a harmless import cycle between `synthesizer.ts` and `falKokoro.ts`.
- **Task 5:** whitespace-only page text is `no-such-slot`. It is free and answers 404.
- **Task 5:** concurrent first-Plays share one in-flight generation, and only the originator is charged. A joiner retries its own quota if the originator hit theirs. An upstream failure is shared.
- **Task 5:** an unparseable `segments_json` throws instead of regenerating, to avoid a duplicate-row loop that would pay each time.
- **Task 5:** synthesis concurrency is capped at 4 sentences per page.
- **Task 6:** `GET` for a page the book doesn't have answers 200 `missing`. `POST` answers 404.
- **Task 6 test gaps:** the char-priced quota re-check is wired but untested, because seed pages are too short. The 503 monthly-ceiling path isn't tested in the narration route tests.
- **Task 7:** 401 maps to generation-unavailable, the same as signed out (the spec didn't name 401). 429 and 503 map to quota, which is sticky for the session.
- **Task 7:** Cancel does not abort an in-flight POST. The generation is already paid for and is cached for the next Play.
- **Task 7:** the client clip cache is keyed `(bookId, slot, voiceId)` without the text hash. A mid-session edit that leaves sentence offsets identical could replay old audio until reload. Accepted for the alpha.
- **Task 7:** preload uses a second, never-played `Audio` element.
- **Task 8:** the hook gained a `nextTarget` argument and an `activeVoiceURI` result.
- **Task 8:** fallback is a fresh device-voice run (new `runId`, watchdog armed). The rest of that page stays on the device voice.
- **Task 8:** the voices-route answer is cached at module level once per session, including a failure.
- **Task 8, pre-existing:** `client/eslint.config.js` lints only `**/*.{js,jsx}`, so `npm run lint` checks no TypeScript. Follow-up: [#129 — client `npm run lint` checks one file](https://github.com/slickG0ose/storybook/issues/129).

## Reviewer findings and how each was handled

- **Medium — fal per-request rounding unverified:** shipped for review with this still open (Nick, 2026-11-08). It is a merge-gate item in the test plan. If fal rounds per request, `narrationCostCents` switches to `segments × 2¢` before merge. Until then the spend caps may undercount narration by up to 6–8×, bounded by the 200¢ daily and global monthly caps.
- **Medium — two surprises without tracking:**
  - Deferred: post-alpha — route tests for the 503 monthly ceiling on POST and for a char-priced denial after the 1¢ `spendGate` reservation. Both paths reuse the existing, tested `sendQuotaDenied`, and the service test pins the char price; seed pages are too short to land between the floor and the cap.
  - Deferred: post-alpha — client clip cache keyed without the text hash. Only an in-session edit that keeps every sentence offset identical replays stale audio, and a reload clears it; any other edit fails the offset check and falls back to the device voice.
- **Low — `CLAUDE.md` spend line omitted `style_reference: 2`:** fixed in this PR; "per page" corrected to "per slot".
- **Low — POST checks the daily cap before the cache lookup:** accepted. The client always GETs first, so only a GET-miss/POST race reaches it, and nobody is ever overcharged — a capped user is at worst refused a free cached clip.
- **Low — e2e imports shared logic:** exception now documented in `docs/conventions/testing.md` ("Shapes: copy locally, except shared logic").
- **Low — eslint gap not linked:** linked to #129 above.

## Ops before the alpha hears it

Production availability needs `STORAGE_BACKEND=r2` and the five `R2_*` vars set **with values** in Render. A `sync: false` key can be listed while its value is blank. Without them, `/api/narration/voices` reports `available: false` and readers get device voices. That is safe, but the alpha would not hear the new voices.

## Accepted open risk

fal's terms (2026-09-08) require a Customer Solution's End Users to be 18+. Account holders are adults, which is the same posture as illustrations. The exit is self-hosted Kokoro (Apache-2.0), with Amazon Polly as the named fallback. See ADR-033.

### Task 9 surprises
- AI disclosure is a visible line in the player (the settings panel is closed by default), not literally under the select.
- "Device default" label reads "Default voice" when AI voices are listed.
- The "Sign in for the AI voice" notice also covers a 501 (no `FAL_KEY`); the voices route normally hides AI voices in that case.
- While preparing, the play button's accessible name stays "Pause".

### Task 10 surprises
- New spec imports `splitIntoUtterances` / `narrationTextFor` from `shared/src/narration` so stubbed clip offsets match the client exactly — a deliberate break from the e2e "copy shapes locally" precedent (`e2e/tests/_editPublished.ts`).
- Signed-in state is a seeded `storybook-auth` + stubbed `/api/auth/me`; no DB users written.
- `tests/narration.spec.ts` "no speech engine" test now stubs `/api/narration/voices` as unavailable: with a real `FAL_KEY` in a developer `.env`, generated voices made the player usable and the test failed locally (CI has no key, so it passed there).
