# Private media: short-lived signed URLs — task plan

> Spec: [spec.md](spec.md)
> Status: Approved (owner, 2026-11-16)
> Last updated: 2026-11-16

## Overview

Twelve tasks in rollout order. Production never sees a broken image between merges.

- **PR A, Tasks 1 to 4.** Moves serving to "verify, then disk, then presign" in **lenient** mode while the URLs stay unsigned.
- **PR B, Tasks 5 to 7.** Starts emitting signed URLs, puts style photos behind the seam, and makes the client tolerant of expiry.
- **PR C, Tasks 8, 10 and 12.** The e2e spec and the docs.
- **PR D, Task 9.** A one-line switch to `enforce`, merged when the owner decides.
- **Task 11** is the owner's own bucket flip. It is not developer work.

The server tasks are strictly serial. The client work (Task 7) can run beside them once Task 1 is done.

Written for the spec's recommended rulings on its five open questions. A different ruling on 2 or 3 means re-dispatching the architect. A different number on 1 or 4 is a constant change inside Task 3 or Task 4.

## Cross-cutting constraints

- **Guardrail, new dependency:** `@aws-sdk/s3-request-presigner` (Task 4). USER CONFIRMATION REQUIRED: the spec must read `Status: Accepted`, set by the owner. Say so in the PR A body.
- **No guardrail on auth or session.** Media links are capability URLs. Do not touch `Authorization`, `storybook-auth`, `storybook-session`, `getAuthUser` or middleware order.
- **Wire-shape:** no Zod schema changes. Media fields gain `?e=&s=`; their names and types stay. New `toMatchObject` pins use `expect.stringMatching(...)` (Task 5). Existing exact-URL assertions move to `mediaPath(...)`. Edit them; do not delete them.
- **Stored values never signed.** Every DB write of a media URL goes through `mediaPath()`. Never write a value containing `?`.
- **Do not change** `pdf.tsx`, `illustrations.ts` reference resolvers, `providers/fal.ts`, `imagePin.ts` or `services/narration/narration.ts`. Their existing tests must pass unedited.
- **Env fails closed:** a malformed `MEDIA_URL_MODE` means `enforce`, and an unset prod secret means a random secret. Never unsigned. Warnings name the variable, never a value.
- **Dark-mode parity:** the one new UI string in `CreateBook` (Task 7).
- **Migrations:** none.
- **Spend:** nothing here calls a paid API. Tests must not reach Anthropic or fal.
- **One server-zone agent at a time** (shared `test.db`).
- **PR #238 dependency:** Tasks 2 and 6 edit lines that #238 changes (`generate.ts`, `uploads.ts`). Do not start them until #238 is merged into `master`. Rebase first.

## Tasks

### Task 1 — Shared media helpers

**Zone:** shared
**Depends on:** none
**Parallel-safe with:** none on the server; Task 7 starts after this
**Owner step after merge:** none
**Status:** Done (2026-11-16)

**Files to add or change:**
- `shared/src/media.ts`: new
- `shared/src/index.ts`: re-export
- `shared/src/__tests__/media.test.ts`: new (follow where existing shared tests live; if none, put it beside the module, matching the client's import style)

**Signatures / shapes:**
```ts
export const MEDIA_EXPIRES_PARAM = 'e';
export const MEDIA_SIG_PARAM = 's';
export const MEDIA_ROOTS = ['illustrations', 'uploads'] as const;
export type MediaRoot = (typeof MEDIA_ROOTS)[number];
/** Matches a stored or signed media path: /illustrations/... or /uploads/... */
export const MEDIA_PATH_RE: RegExp; // /^\/(illustrations|uploads)\/[^?#]+/
/** Strips ?query and #hash. Returns non-media strings unchanged after stripping. Never throws. */
export function mediaPath(url: string): string;
export function mediaPath(url: null | undefined): null;
/** Epoch ms from the `e` param, or null when absent or non-integer. Never throws. */
export function mediaExpiresAt(url: string | null | undefined): number | null;
```

**Tests to write:**
- `mediaPath`: unsigned in, unsigned out; strips signed and `#`; null passthrough; a non-media string is only stripped.
- `mediaExpiresAt`: integer `e` gives ms; missing, `e=abc`, `e=1.5` and a URL with no query give `null`.
- Wire-shape assertion required: no

**Done when:** the tests pass, `cd client && npm run typecheck` and the server typecheck both resolve `@storybook/shared` with no new errors.

---

### Task 2 — Inbound canonicalisation on the two write paths
**Status:** Done (2026-11-16)
**WAITS FOR PR #238 TO MERGE.**

**Zone:** server
**Depends on:** Task 1, #238
**Parallel-safe with:** 7
**Owner step after merge:** none

**Files to add or change:**
- `server/src/routes/books.ts`: `PUT /:id/illustrations/:pageNumber/revert` (`:1124-1157` today)
- `server/src/routes/generate.ts`: apply `mediaPath()` inside #238's `ownStyleReferenceUrl` before its regex
- `server/src/routes/__tests__/books.test.ts`, `server/src/routes/__tests__/generate.test.ts`: extended

**Signatures / shapes:**
```ts
// revert
const url = mediaPath((req.body as BookIllustrationRevertRequest).url);
if (!history.some(v => mediaPath(v.url) === url)) return res.status(400)...;
// store `url` (canonical)

// generate.ts (after #238)
function ownStyleReferenceUrl(raw: string | undefined): string | null {
  const value = raw ? mediaPath(raw.trim()) : '';
  return value && STYLE_REFERENCE_PATH.test(value) ? value : null;
}
```

**Tests to write:**
- Revert with `url + '?e=9999999999&s=x'` gives 200, and `prisma.page` `illustration_url` equals the bare path.
- Revert with a signed URL for another page's art still gives 400 (#100 stays closed).
- Generate with a signed `styleReferenceUrl` stores the bare path. Use the existing generate-test mocking; no live Anthropic call.
- Wire-shape assertion required: no new shape

**Done when:** the tests pass, `cd server && npm test` is green, and there are no new TS errors.

---

### Task 3 — Media URL signer: config, sign, verify

**Status:** Done (2026-11-16)

**Zone:** server
**Depends on:** Task 1
**Parallel-safe with:** 7
**Owner step after merge:** none

**Files to add or change:**
- `server/src/lib/mediaUrl.ts`: new, pure. Imports only `node:crypto`, `@storybook/shared` and `isValidKey` from `services/storage`.
- `server/src/lib/__tests__/mediaUrl.test.ts`: new

**Signatures / shapes:**
```ts
export const DEFAULT_MEDIA_TTL_MINUTES = 60;   // range 5..1440
export type MediaMode = 'enforce' | 'lenient';
export interface MediaConfig { secret: Buffer; previous: Buffer | null; ttlMinutes: number; mode: MediaMode }
/** Memoized. Prod + secret unset or < 32 chars -> random 32 bytes + one warn. Non-prod + unset -> fixed dev constant. */
export function getMediaConfig(env?: NodeJS.ProcessEnv): MediaConfig;
export function __resetMediaConfigForTests(): void;

/** Window maths. e = (floor(t/W)+2)*W in seconds; windowStart = floor(t/W)*W. */
export function mediaWindow(now: Date, ttlMinutes: number): { windowStart: Date; expiresAt: number /* epoch s */ };

/** '/illustrations/<key>' | '/uploads/<key>' (already canonical) -> signed path. Returns input unchanged if not a media path or the key is invalid. Canonicalises first (idempotent). */
export function signMediaPath(path: string, now?: Date, cfg?: MediaConfig): string;

export type VerifyResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'too-far' | 'bad-signature' };
/** `rawPath` is req.path relative to the mount (still percent-encoded). Decodes once, isValidKey, refuses trailing '/', refuses 'uploads/' first segment under root 'illustrations'. timingSafeEqual on 32-byte digests. Tries secret then previous. */
export function verifyMediaRequest(root: MediaRoot, rawPath: string, query: Record<string, unknown>, now?: Date, cfg?: MediaConfig): VerifyResult & { key?: string };
```
HMAC input: `` `v1\n${root}\n${key}\n${e}` ``. Output: base64url, unpadded.

**Tests to write:** the full list in spec §Test strategy for `mediaUrl.test.ts`. In addition:
- 1,000 signs within one window give one distinct output.
- `MEDIA_URL_MODE=Enforce ` (case and whitespace) gives `enforce`; `off` gives `enforce` with one warning.
- `MEDIA_URL_TTL_MINUTES` `'4'`, `'1441'`, `'60m'` and `'abc'` each give 60.
- The dev constant is never used when `NODE_ENV=production`.
- Wire-shape assertion required: no

**Done when:** the tests pass, `cd server && npm test` is green, and nothing imports the module yet.

---

### Task 4 — Serving: verifier, disk, presign redirect, lenient mode (stage 1)

**Status:** Done (2026-11-16)

> USER CONFIRMATION REQUIRED: new dependency. The spec must be `Status: Accepted`.

**Zone:** server and config
**Depends on:** Task 3
**Parallel-safe with:** 7
**Owner step after merge:** YES. After the Render deploy, confirm the log has no `MEDIA_URL_SECRET` warning and that Environment lists `MEDIA_URL_SECRET` with a **non-blank** value (`sync: false` and `generateValue` keys can look set when they are not; memory note). Then load one R2-backed book and confirm a 302 to `*.r2.cloudflarestorage.com` (spec checklist A, items 2, 3 and 5).

**Files to add or change:**
- `server/package.json`, `package-lock.json`: `@aws-sdk/s3-request-presigner`, pinned to the installed `@aws-sdk/client-s3` version (3.1164.0 at time of writing; re-check). Run `npm ls @smithy/signature-v4` and confirm it shows one version.
- `server/src/services/storage.ts`:
  - `R2Storage.presignGet(key, { signingDate, expiresIn })`.
  - An optional `keyPrefix` constructor option, applied to every S3 key in `put`, `get`, `head`, `list` (stripped from returned keys) and `remove`.
  - `R2_PUBLIC_BASE_URL` removed from `R2_REQUIRED_VARS` and from the `https://` check; `publicBaseUrl` removed from `R2Config`.
  - Export `UPLOADS_DIR`.
- `server/src/middleware/media.ts`: new.
  - `mountMedia(app)` mounts, for each root: `mediaGate(root)` → `express.static(dir, { setHeaders })` → `mediaPresignRedirect(root)`.
  - The `uploads` root uses `UPLOADS_DIR` and storage key `uploads/<key>`. Task 6 switches that to `getUploadStorage()`. Until then, the uploads root presigns through the illustrations `R2Storage` client with an explicit `uploads/` prefix.
- `server/src/middleware/illustrationRedirect.ts`: deleted. Its test is **ported** into `media.test.ts`.
- `server/src/index.ts`: replace `:88-93` with `mountMedia(app)`. `/hero` is untouched.
- `server/src/__tests__/setup.ts`: `createTestApp()` calls `mountMedia(app)`.
- `render.yaml`:
  - `MEDIA_URL_SECRET` (`generateValue: true`), `MEDIA_URL_SECRET_PREVIOUS` (`sync: false`), `MEDIA_URL_MODE` (`value: lenient`), each with a comment.
  - Update the `R2_PUBLIC_BASE_URL` comment at `:90-101` to say it is unused and optional.
- `server/.env.example`: commented entries for the four new vars.
- Tests: `server/src/middleware/__tests__/media.test.ts` (new), `server/src/services/__tests__/storage.test.ts` (extend), `server/src/__tests__/mediaRenderYaml.test.ts` (new, beside `rateLimitScope.test.ts`).

**Signatures / shapes:**
```ts
// mediaGate(root): GET/HEAD only (others -> next()). verifyMediaRequest(...).
//   ok        -> res.locals.mediaExpiresAt = e; next()
//   not ok, enforce -> 403 { error: 'Link expired' }, Cache-Control: no-store
//   not ok, lenient -> lenient counter++; res.locals.mediaExpiresAt = null; next()
// express.static setHeaders: if mediaExpiresAt -> `private, max-age=${max(0, e - nowS)}`; else leave default.
// mediaPresignRedirect(root): only when resolveBackendName()==='r2' and GET/HEAD; else next() (404).
//   key validated (same as today); window = mediaWindow(now, ttl);
//   expiresIn = (mediaExpiresAt ?? window.expiresAt) - windowStart  (lenient unsigned uses current window)
//   302 Location = await r2.presignGet(storageKey, { signingDate: windowStart, expiresIn }); same Cache-Control rule.
```

**Tests to write:**
- `media.test.ts`: every server bullet in spec §Test strategy.
- The ported redirect assertions: invalid key gives 404, never a redirect; non-GET falls through; the Location host is always the presigned one. Mock `getSignedUrl`.
- `storage.test.ts`:
  - `presignGet` passes `signingDate` and `expiresIn` through.
  - `keyPrefix` is applied and stripped.
  - `readR2Config` no longer requires `R2_PUBLIC_BASE_URL`.
  - The existing missing-var message for the other four is unchanged.
- `mediaRenderYaml.test.ts`: `MEDIA_URL_SECRET` has `generateValue: true`; `MEDIA_URL_MODE` is `lenient` or `enforce`.
- Wire-shape assertion required: no. The 302, 200 and 403 bodies are binary or error envelopes. Pin the 403 envelope with `toMatchObject({ error: expect.any(String) })`.

**Done when:** the tests pass, `cd server && npm test` is green, there are no new TS errors, and `grep -rn "R2_PUBLIC_BASE_URL\|illustrationRedirect" server/src` shows only comments or tests asserting it is optional.

---

### Task 5 — Sign every outbound media URL (stage 2)

**Status:** Done (2026-11-16)

**Zone:** server
**Depends on:** Tasks 2 and 4
**Parallel-safe with:** 7
**Owner step after merge:** YES. Spec checklist A, items 1 to 5, then start the 48-hour watch on the `[media] lenient:` lines (open question 5).

**Files to add or change:**
- `server/src/middleware/media.ts`: add `signMediaResponses`.
- `server/src/index.ts`: `app.use('/api', signMediaResponses)` **before** the first `app.use('/api/...', router)`.
- `server/src/__tests__/setup.ts`: the same, in `createTestApp()`.
- `server/src/routes/__tests__/*.test.ts`: move exact-URL assertions on **response bodies** to `mediaPath(...)`. Assertions on `prisma.*` reads stay exact. Grep: `grep -rn "illustrations/\|uploads/" server/src/routes/__tests__ | grep -E "res\.body|body\."`.
- `server/src/middleware/__tests__/signMediaResponses.test.ts`, `server/src/routes/__tests__/mediaSigning.test.ts`: new.

**Signatures / shapes:**
```ts
const SIGNED_KEYS = new Set(['illustration_url', 'cover_url', 'portrait_url', 'style_reference_url', 'url']);
export function signMediaResponses(req: Request, res: Response, next: NextFunction): void;
// wraps res.json once; deep copy-on-write over plain objects/arrays (depth cap 8);
// string under SIGNED_KEYS matching MEDIA_PATH_RE -> signMediaPath(mediaPath(v), now)
// `now` is captured once per response so every URL in it shares a window.
```

**Tests to write:**
- `signMediaResponses.test.ts`: unit cases from spec §Test strategy.
- `mediaSigning.test.ts`:
  - **Sweep:** seed a draft that has cover, page art, a portrait, a style ref, one `IllustrationVersion` row and a narration clip row (no fal; insert the rows directly). Hit every route in the spec's route table **as its owner and as admin**. Walk each JSON body and fail on any string matching `^/(illustrations|uploads)/` without `e=` and `s=`, except the key `path`.
  - **Wire-shape pins:** `toMatchObject` with `expect.stringMatching(/^\/illustrations\/[^?]+\?e=\d+&s=[A-Za-z0-9_-]{43}$/)` for `GET /api/books/:id` (`cover_url`, `pages[0].illustration_url`, `characters[0].portrait_url`), `/mine`, `GET /api/books`, `GET …/illustrations/:n` (`[0].url`), `GET …/portraits`, `GET …/narration` (`segments[0].url`) and `GET /api/admin/books`.
  - **Stable within a window:** fake timers, two `GET /api/books/:id` calls give deep-equal bodies.
  - **DB stays unsigned:** after the sweep, no `Page.illustration_url` or `Book.cover_url` contains `?`.
  - **Admin orphan list:** `path` is unsigned.
- Wire-shape assertion required: yes. The response shapes are the existing `BookDetailResponseSchema`, `BookListResponseSchema`, `BookMineResponseSchema`, `IllustrationVersionListResponseSchema`, `CharacterPortraitVersionListResponseSchema` and `NarrationGetResponseSchema`.

**Done when:** the tests pass, `cd server && npm test` is green with no test deleted (assertions converted only, listed in the hand-back), and there are no new TS errors.

---

### Task 6 — Style-reference uploads behind the storage seam
**WAITS FOR PR #238 TO MERGE.**

**Zone:** server
**Depends on:** Task 4 and #238. Run after Task 5, because both edit `setup.ts`-adjacent tests and the server is serial.
**Parallel-safe with:** 7
**Owner step after merge:** YES. Spec checklist A, item 6 (upload, restart, still served).

**Files to add or change:**
- `server/src/services/storage.ts`:
  - `getUploadStorage()`: local root `UPLOADS_DIR`; under r2, `R2Storage` with `keyPrefix: 'uploads/'` and fallback `new LocalStorage(UPLOADS_DIR)`.
  - `RESERVED_TOP_LEVEL_KEYS = ['uploads']`.
- `server/src/routes/uploads.ts`: replace `mkdir` and `writeFile` with `getUploadStorage().put(\`style-refs/${id}.${ext}\`, bytes, type)`. `bytes` and `type` are #238's sanitised output. The returned `url` stays `/uploads/style-refs/<file>`; Task 5's middleware signs it.
- `server/src/middleware/media.ts`: the uploads root presigns through `getUploadStorage()`.
- `server/src/routes/admin.ts`: the orphan scan skips reserved entries; `DELETE /orphan-illustrations/:id` answers 400 for a reserved id.
- Tests: `uploads.test.ts`, `storage.test.ts`, `admin.test.ts` (extend).

**Tests to write:**
- An upload under `local` writes to `public/uploads/style-refs/`. Use a temp root or clean up, as the existing upload tests do.
- Under r2, with a mocked `S3Client`, `PutObject` gets `Key: 'uploads/style-refs/<uuid>.jpg'` and the **stripped** bytes: no `Exif` in the body, reusing #238's fixture.
- The upload response `url` matches the signed `/uploads/style-refs/…` regex.
- The orphan list omits `uploads` even when keys exist under it. DELETE on `uploads` gives 400 and removes nothing.
- Wire-shape assertion required: the upload response has no shared schema (`uploads.ts` has no `validate`). Pin it with `toMatchObject({ url: expect.stringMatching(...), descriptor: expect.anything() })`.

**Done when:** the tests pass, `cd server && npm test` is green, and there are no new TS errors.

---

### Task 7 — Client: tolerate and recover from expired links

**Status:** Done (2026-11-16)

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** 2 to 6 (and ships safely before them: unsigned URLs make every new path a no-op)
**Owner step after merge:** manual browser check below, in light and dark mode

**Files to add or change:**
- `client/src/lib/mediaRefresh.ts`: new.
- `client/src/hooks/useImageFallback.ts`: dispatch on an expired error.
- `client/src/pages/BookDetail.tsx`, `MyBooks.tsx`, `Home.tsx`: `useMediaRefresh(refetch, urls)`.
- `client/src/components/BookSpread.tsx:912`, `client/src/pages/BookDetail.tsx:1102`: compare with `mediaPath`.
- `client/src/lib/narration/generatedProvider.ts`: stale-entry refetch, plus one retry on `onerror`.
- `client/src/pages/CreateBook.tsx:340-343`: the preview goes through `useImageFallback`, falling back to "Style picture attached" (`text-sm text-gray-600 dark:text-gray-300`).
- `client/src/__tests__/pwaOptions.test.ts`: no media `runtimeCaching`.
- Tests beside each.

**Signatures / shapes:**
```ts
// client/src/lib/mediaRefresh.ts
export const MEDIA_EXPIRED_EVENT = 'storybook:media-expired';
/** Dispatches once per URL for the page's lifetime. */
export function reportExpiredMedia(url: string): void;
/** Subscribes the page's refetch: on MEDIA_EXPIRED_EVENT, and on visibilitychange->visible when
 *  min(mediaExpiresAt(urls)) < now. Throttled to one call per 30 s. Cleans up on unmount. */
export function useMediaRefresh(refetch: () => void, urls: ReadonlyArray<string | null | undefined>): void;
```
`useImageFallback.onError`: call `reportExpiredMedia(url)` when `mediaExpiresAt(url)` is not null and is at most `Date.now() + 30_000`. Keep the per-URL failed memory exactly as today.

**Tests to write:**
- `useImageFallback.test.ts`: an expired signed URL dispatches once (twice `onError` gives one event); a future-`e` URL and an unsigned URL do not dispatch; fallback behaviour unchanged.
- `mediaRefresh.test.ts`: throttle; visibility path; unmount removes listeners.
- Page tests (`BookDetail`, `MyBooks`, `Home`): an event causes one refetch through mocked fetch; a second event within 30 seconds causes none.
- `BookSpread.test.tsx`: version-strip "current" marker with a different `s` on each side.
- `generatedProvider.test.ts`: a cached entry with `e` 60 seconds out is refetched before playing; an `onerror` with past `e` refetches once and resumes at the same index; a second error gives `synthesis-failed`. Use injected `fetchImpl`; no network.
- `CreateBook.test.tsx`: image error shows the "Style picture attached" text.
- `pwaOptions.test.ts`: `runtimeCaching` is absent, or none of its `urlPattern`s match `/illustrations/x.png` or `/uploads/style-refs/x.jpg`.
- Wire-shape assertion required: no

**Manual verify:** against a local server with `MEDIA_URL_TTL_MINUTES=5`:
- Open a book, wait about 10 minutes, then turn a page. The art loads without a reload.
- Background the tab past expiry and return. One `GET /api/books/:id` fires.
- Read aloud with a generated voice across the expiry.
- Check `CreateBook`'s fallback text in light and dark mode.

**Done when:** the tests pass, `cd client && npm test` is green, and typecheck, lint and build are clean.

---

### Task 8 — e2e: expired link recovers; unsigned link refused

**Zone:** e2e
**Depends on:** Tasks 5 and 7
**Parallel-safe with:** 10
**Owner step after merge:** none

**Files to add or change:**
- `e2e/tests/mobile/media-expiry.spec.ts`: new; runs under `mobile-pixel` and `mobile-small`.

**Shape:**
- Inside `forEachTheme`, open the seed book `luna-star-garden`.
- `page.route('**/api/books/luna-star-garden', …, { times: 1 })` fetches the real response, rewrites the cover and every `illustration_url` so `e` is 1 hour ago and `s` is 43 `A`s, and fulfils with that.
- Expect the real image to become visible with no reload: an `img` with alt text, `naturalWidth > 0`, and `src` containing an `e` greater than now.
- Then `expectNoHorizontalOverflow` and `expectTapTargets`.
- `request.get(\`${API_BASE}/illustrations/luna-star-garden/page-1.jpg\`)` gives 403. The e2e server runs the code default, `enforce`.
- The header comment claims the **correctness** half of Done criterion 2 (ADR-009).
- Also run the full suite and confirm `narration-generated.spec.ts:162`'s route glob still intercepts (spec, UNVERIFIED item). If it does not, widen the glob to tolerate a query string. Do not delete the test.

**Tests to write:** the above. Wire-shape assertion required: no

**Done when:** `cd e2e && npm test` is green, and the new spec passes in both mobile projects with no retry.

---

### Task 9 — Switch production to `enforce` (stage 4)
**OWNER DECIDES WHEN THIS MERGES.** Not before the 48-hour window in spec open question 5, and checklist A passing.

**Zone:** config
**Depends on:** Tasks 5, 7 and 8 deployed, and checklist A done
**Parallel-safe with:** none
**Owner step after merge:** YES. Spec checklist B, items 1, 2, 4 and 5. Rollback: dashboard `MEDIA_URL_MODE=lenient`, then revert.

**Files to add or change:**
- `render.yaml`: `MEDIA_URL_MODE` `value: enforce`, with the comment updated to name the dashboard rollback.
- `server/src/__tests__/mediaRenderYaml.test.ts`: tighten to `enforce`.

**Done when:** the harness and server suites are green. The PR body quotes the rollback.

---

### Task 10 — Docs, conventions and the Privacy copy

**Zone:** docs, plus one client copy edit
**Depends on:** Tasks 4 to 7
**Parallel-safe with:** 8
**Owner step after merge:** none

**Files to add or change:**
- `docs/conventions/data.md` §Illustration storage:
  - Rewrite §Serving: verifier → disk → presign, the signature format, `MEDIA_URL_*` vars, lenient and enforce.
  - Delete "The art is storefront content…" (`:186`) and replace it with the private-by-default reason.
  - Rewrite §Operator setup steps 2 and 6: no `r2.dev` public access; verification is spec checklists A and B; the bucket-private flip and its rollback.
  - Add the immutable-keys rule.
  - `public/uploads` is now behind the seam under the reserved `uploads/` prefix (replacing `:142`).
  - `R2_PUBLIC_BASE_URL` becomes optional.
- `docs/conventions/server.md:219` (static assets) and `:31` (`uploads.ts` comment): `/illustrations` and `/uploads` are signed; `signMediaResponses` is the choke point; the inbound `mediaPath` rule for any new write path.
- `docs/conventions/client.md`: render media only through `FallbackImage` or `useImageFallback`; compare media URLs with `mediaPath`; `useMediaRefresh` for any page that holds book JSON.
- `docs/conventions/call-graph.md`: `media` middleware and `lib/mediaUrl` edges; `uploads → storage`; `shared/media` fan-out. Regenerate with the file's greps.
- `CLAUDE.md`, the layout paragraph on illustration storage: bytes are served through short-lived signed links (`MEDIA_URL_*`), not a public bucket. **Owner edit, or with his OK.** Draft the sentence in the hand-back if not permitted.
- `render.yaml`: the free-plan caveat at `:9-12` is stale (R2 exists). Correct the comment only.
- `docs/deploy-spike-render.md`: a one-line pointer from the illustration-persistence section to data.md.
- `client/src/pages/Privacy.tsx:89`: "Pictures and audio are stored at web addresses that are hard to guess but not password-protected." becomes "Pictures, audio and style pictures are shown through private links that stop working within two hours. Anyone you share a link with can open it until then." This is a text-only change; existing classes already carry `dark:`. Update `Privacy.test.tsx` if it pins the sentence.

**Tests to write:** none new. `npm test` at the repo root (harness), and `cd client && npm test` if `Privacy.tsx` is pinned.

**Done when:** `grep -rn "storefront content\|public-read\|pub-<hash>" docs/conventions` returns nothing stale, and the harness suite is green.

---

### Task 11 — OWNER ONLY: make the bucket private (stage 5)

Not a developer task. No agent performs any step here.

1. Precondition: Task 4 deployed and checklist A passed. Task 9 is recommended first; spec decision 6 explains why the order is free.
2. Cloudflare dashboard → R2 → the bucket → Settings → Public access → **R2.dev subdomain → Disallow**. Under Custom Domains, confirm none is connected.
3. Run spec checklist B, items 3, 4 and 6.
4. Rollback: re-allow the R2.dev subdomain.
5. Optional, any time later: delete `R2_PUBLIC_BASE_URL` from the Render dashboard (unused since Task 4).

**Done when:** the owner records the date and the checklist B result on #237.

---

### Task 12 — Pre-merge follow-ups

**Zone:** docs (harness)
**Depends on:** none (run last, in PR C)

For each of the seven ADR-worthy items in the spec, make sure exactly one tracking action exists: a matching ADR, a linked issue, or an explicit `Deferred:` line with its reasoning.

- Record them through `/create-adr`, starting at **ADR-039**. They may be bundled as two ADRs:
  - "Serving and signing" covers items 1 to 4 and 7.
  - "Presigner dependency and uploads keyspace" covers items 5 and 6.
- Each needs a `**Scope:**` line naming the `signed-media-urls` spec.
- Mark **ADR-026 Superseded by ADR-039**. Add an amendment line to **ADR-025** (uploads keyspace, signed serving) and **ADR-027** (presigner added).
- Open one follow-up issue each for:
  - a read-only R2 token used only for presigning (spec, Out of scope);
  - deciding whether to stop retaining style photos, only if the owner ruled "keep" on open question 3 and wants it revisited.

**Done when:** `adr-tracking-check signed-media-urls` reports zero orphaned items.

## Sequencing notes

| PR | Tasks | Prod effect on merge |
|---|---|---|
| A | 1, 2, 3, 4 | Serving moves to verify-then-presign in lenient mode. URLs unchanged. Bucket still public. |
| B | 5, 6, 7 | Server signs URLs; style photos are durable; client recovers from expiry. Still lenient. |
| C | 8, 10, 12 | Tests, docs and ADRs only. |
| D | 9 | Enforcement. The owner chooses when. |
| — | 11 | Owner's dashboard flip. |

- **Server chain is strictly serial:** 2 → 3 → 4 → 5 → 6. Task 2 can move after Task 4 if #238 is late, but **it must merge before or with Task 5**, because old clients will echo signed URLs from the moment Task 5 deploys.
- **#238 gate:** if #238 has not merged when PR A is ready, ship PR A without Task 2, and put Task 2 at the front of PR B. Do not ship Task 5 without Task 2.
- **Client (Task 7)** may merge before PR B. Pages and Render deploy independently, and every ordering of them is safe: the old client tolerates signed URLs, and the new client treats unsigned URLs as non-expiring.
- **Rough size:** Tasks 1, 2, 9 and 11, under an hour each. Tasks 3, 6, 8, 10 and 12, 1 to 3 hours each. Tasks 4, 5 and 7, half a day each. About three working days of developer time, plus the owner's 48-hour watch.

## Open questions

None for the developer. The five owner calls are at the top of [spec.md](spec.md) and are resolved when the owner sets `Status: Accepted`. If he says "go" with no rulings, the recommended defaults apply.
