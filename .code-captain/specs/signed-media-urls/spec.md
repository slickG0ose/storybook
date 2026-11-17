# Private media: short-lived signed URLs for art, narration audio and uploaded photos

> Status: Accepted (owner, 2026-11-16: recommended default on all five open questions; new dependency `@aws-sdk/s3-request-presigner` approved)
> Last updated: 2026-11-16
> Backlog: [#237 — Private books: illustrations, narration audio and uploaded photos are served from public, permanent URLs](https://github.com/slickG0ose/storybook/issues/237)
> Related: [#238 — fix(server): rate-limit paid routes, strip photo metadata, hide style-reference URL from readers](https://github.com/slickG0ose/storybook/pull/238) (open, not merged; Tasks 2 and 6 wait for it) · [#192 — prune superseded versions, move R2 off r2.dev](https://github.com/slickG0ose/storybook/issues/192) (out of scope, see below)
> Supersedes: ADR-026 (302 to a public bucket). Amends: ADR-025 (keyspace, `/uploads` behind the seam), ADR-027 (adds `@aws-sdk/s3-request-presigner`). ADRs at `.code-captain/product/decisions.md`.

## Open questions for the owner — RESOLVED 2026-11-16

The owner accepted the recommended default on all five. The task plan runs on these.

1. **How long does a media link live?** Recommended: **1-hour windows. Every link works for at least 1 hour and at most 2 hours after the page that showed it loaded.** It is a setting (`MEDIA_URL_TTL_MINUTES`, default 60, range 5 to 1440). Longer means fewer re-downloads and a longer life for a leaked link. A 6-hour window, for example, means links live 6 to 12 hours.
2. **Do published books go through the same signed links?** Recommended: **yes, one path for everything.** Nothing here needs a stable public image URL: the app has no per-book social preview (`client/index.html:49` is one static `og:image`), and a book flipped back to private stops being reachable within 2 hours. The alternative, a public custom domain for published art, belongs to #192.
3. **Keep uploaded style photos after their style is read?** Recommended: **keep them, private, behind the storage seam** (the issue's proposal, Task 6). The case for deleting them instead: nothing reads `Book.style_reference_url` after creation. The server never re-reads the file (only `routes/generate.ts:235` writes the column), and no client screen shows it except the creation wizard's own preview (`CreateBook.tsx:340-343`). Deleting is the stronger privacy choice and would shrink Task 6. It is a product change, so it is the owner's call.
4. **Can a browser keep private art in its disk cache?** Recommended: **yes, until the link expires** (`Cache-Control: private, max-age=<seconds left>`). Re-reading a book within the window costs no bandwidth. The cost is that on a shared computer the bytes stay in the browser's cache until it evicts them. The alternative is `no-store`, which means a full re-download on every page turn.
5. **When does enforcement go on?** Recommended: **48 hours after the client release (Task 7) reaches Pages**, once the Render log shows unsigned requests are rare. Installed PWAs pick up a new client only when the user accepts the update prompt (`client/pwa.config.ts:12`). Until they do, old clients send unsigned links, and enforcement turns those images into placeholders until the user reloads.

## Problem

Page art, covers, character portraits and narration WAVs are served at `GET /illustrations/<bookId>/...`. That route runs `express.static` and then `illustrationRedirect` (`server/src/index.ts:88-92`), which 302s to the **public-read** R2 bucket at `${R2_PUBLIC_BASE_URL}/<key>` (`server/src/middleware/illustrationRedirect.ts:17-34`). Style-reference photos are served at `GET /uploads/style-refs/<uuid>.<ext>` by a bare `express.static` (`server/src/index.ts:93`). Neither route checks who is asking or what state the book is in.

The API itself does gate access correctly. `GET /api/books/:id` 404s another user's draft (`server/src/routes/books.ts:178-183`), and so does `GET /api/books/:id/narration` (`server/src/routes/narration.ts:69`, `:95-99`). So a private book's media is protected only by an unguessable UUID in its URL. That URL never expires. It keeps working after the book is deleted, after it is made private again, and after its author signs out. Anyone who ever saw it can fetch the image for good: a screenshot with dev tools open, a shared browser's history or cache, a link pasted into a chat.

Since #235, every book starts private and testers are about to be invited. This is the largest privacy gap left.

**`docs/conventions/data.md` gives a stale reason.** `data.md:186` justifies the public bucket because "the art is storefront content and book IDs are UUIDs, so a public bucket exposes nothing that isn't already public", and ADR-026 says "The art is already public". Both stopped being true when books became private by default (#235). Task 10 rewrites both.

### Threat model

**This protects against:**
- A media URL seen once (in history, a screenshot, a chat paste or a log) being usable for good. Once enforcement is on and the bucket is private, it stops working at most 2 hours after the page that issued it loaded.
- Media of a **deleted** book, a book **made private again**, or a book whose author **signed out**. The API stops issuing new links for it at once, and every link already issued dies within 2 hours.
- A direct fetch from the bucket, after the owner turns off `r2.dev` public access (rollout stage 5).

**This does not protect against:**
- **A link is a bearer token for its lifetime.** Anyone holding it can fetch the file for up to 2 hours. There is no per-request identity check: `<img>` and `<audio>` from the Pages origin carry no `Authorization` header, and there are no cookies (auth is a bearer token in localStorage, `server/src/lib/cors.ts:6-12`).
- **Bytes already downloaded.** Saved files, and the browser's disk cache (open question 4).
- **`r2.dev` URLs that have already leaked.** They keep working until the owner disables public access on the bucket. Nothing this code does can revoke them sooner.
- **A leaked `MEDIA_URL_SECRET`.** It lets anyone mint links for keys they already know, and keys contain UUIDs. Rotation is below.
- **Hero frames.** `/hero/<bookId>/...` files are committed and consented (ADR-014, ADR-016) and stay public. A hero-eligible book later made private keeps its committed frames public until a deploy removes them. Out of scope.
- **The lenient window** (rollout stages 1 to 3), which gives no more protection than today.

## Constraints

- **Stored URLs do not change** (ADR-025 decision 3). `Page.illustration_url`, `Book.cover_url`, `characters_json[].portrait_url`, `Book.style_reference_url`, `IllustrationVersion.url` and the narration `segments_json` keys stay relative and unsigned. **No Prisma schema change and no migration.**
- **No `@storybook/shared` wire-shape change.** Every media field is already `z.string()` (`shared/src/books.ts:19,32,89,98,271`; `shared/src/narration.ts:273`), so a signed URL still parses. Adding `shared/src/media.ts` (plain helpers, no Zod schema) is not a wire-shape change.
- **The client wraps every media URL in `api()`** (`client/src/lib/apiBase.ts:7-9`), which prefixes `VITE_API_BASE_URL`. Signed URLs must stay server-relative (`/illustrations/...?e=...&s=...`), never absolute.
- **The local-disk read fallback under `r2` is load-bearing** (ADR-025 decision 4). Seed and fixture art lives only on disk, in the deploy bundle (`data.md:173-177`). Serving must still try disk first.
- **The Render free instance** spins down after 15 minutes idle (`render.yaml:8`), with a best-effort keep-warm ping. Image bytes must not stream through it.
- **New dependency** (`@aws-sdk/s3-request-presigner`): size-gate trigger, needs owner sign-off.
- **Env handling fails safe, in the spirit of `readR2Config`** (`server/src/services/storage.ts:223-242`) and the spend gate: a malformed value falls back to the safe default, never to "off".
- **Middleware order on `/api` is unchanged:** `requireAuth | adminGate → validate → handler`.
- **One server-zone agent at a time.** The server suites share `test.db`.
- **AI calls are never tested here.** No task's tests may reach Anthropic or fal.

## Proposed shape

### Decision 1: one HMAC-signed URL for every backend; under `r2` the handler 302s to a short presigned R2 GET

**Chosen.** Every media URL the API emits has the form `/<root>/<key>?e=<unix-seconds>&s=<base64url HMAC>`, where `<root>` is `illustrations` or `uploads`. One server handler per root, mounted ahead of `express.static`, checks the signature. Then:

1. **Disk first.** `express.static` serves the file if it is on local disk. This covers the `local` backend, and seed and fixture art under `r2`. Range requests work, so audio seeking works.
2. **Disk miss under `r2`:** `302` to a **presigned R2 GET** for the same key. The presign uses `signingDate` set to the start of the current window and `expiresIn` running to the link's own `e`, so it is deterministic within the window (decision 4).
3. **Disk miss under `local`:** the default 404, as today.

**Why one mechanism, and why this one:**

- **Request load stays the same as today.** Every image already hits Render once, for the 302 (`illustrationRedirect.ts`). This adds an HMAC check and a local presign computation (pure crypto, no network call to R2). Bytes still never cross the instance, and cold-start exposure is unchanged.
- **The disk fallback stays free.** Putting presigned R2 URLs straight into API JSON (the main alternative) cannot serve seed art, which is not in R2. Making it work would mean a `HEAD` per key on every serialisation: about 20 network calls to R2 for one book read.
- **One verifier serves `local`, `r2` and `/uploads`.** Dev, the server tests and e2e all run against `local`, so they exercise the same signature code production runs.
- **Range, audio and CORS.** `<img>` and `<audio>` without a `crossorigin` attribute make no-cors requests, which follow a cross-origin 302 and need no CORS headers. The browser repeats `Range` on the redirected request. A SigV4 presigned GET signs only `host`, so `Range` is allowed. **UNVERIFIED in prod:** R2 answering `206` to a ranged presigned GET. It is on the stage-1 checklist. Cloudflare's presign page advises bucket CORS rules "if presigned URLs will be used from a browser". That applies to `fetch`/XHR, and nothing in the client fetches media bytes by script (grep: the only `new Image()` calls are `BookSpread.tsx:118` and `HeroArt.tsx:116`; there is no media `fetch`). So **no bucket CORS change** is planned. If one is ever needed, it is owner-only.
- **Facts the design rests on, verified:** presigned URLs work only on the S3 API endpoint `<account>.r2.cloudflarestorage.com`, never on custom domains (Cloudflare R2 docs, "Presigned URLs"). The server already builds that endpoint (`storage.ts:265`). Maximum expiry is 7 days; this design uses at most 2 days (`MEDIA_URL_TTL_MINUTES` max 1440, times 2). `signingDate` is a supported presigning argument: `SigningArguments.signingDate` in the installed `node_modules/@smithy/types/dist-types/signature.d.ts:21`. **UNVERIFIED:** whether presigned GETs keep working with `r2.dev` public access disabled. Cloudflare's page does not say. Presigning is S3-API auth, independent of public access, so it should. Stage 5 checks it before the flip is final, and re-enabling `r2.dev` is the rollback.

**Alternatives considered:**

| Option | Why not |
|---|---|
| **Two mechanisms:** S3-presigned absolute URLs in the JSON for `r2`, HMAC for `local` and `/uploads` (the issue's proposal) | Breaks the disk fallback for seed and fixture art, or costs a `HEAD` per key per read. Bakes the R2 host into API responses. Two verifiers to test, and only one of them runs in CI. |
| **Stream bytes from R2 through Express** | Pushes ~1.8 MB per image and every WAV through a 512 MB free instance. Range handling becomes our code. This is the load ADR-026 exists to avoid. |
| **Cloudflare-side token auth** (Worker or WAF HMAC rule on a custom domain) | Needs the custom domain from #192, Cloudflare configuration outside the repo, and **UNVERIFIED** plan requirements. Held as the upgrade path once #192 lands: the HMAC format could be checked at the edge instead. |
| **Hand-rolled SigV4 using the transitive `@smithy/signature-v4`** (installed, 5.7.5) | Avoids a declared dependency only by importing an undeclared one. It breaks silently when the SDK's tree changes. Not worth it. |

**Dependency.** Add `@aws-sdk/s3-request-presigner` to `server/package.json` at the **same minor as the installed `@aws-sdk/client-s3`**. The declared range is `^3.1161.0` and 3.1164.0 is installed (`server/package.json:20`, `node_modules/@aws-sdk/client-s3/package.json`). The SDK v3 packages release in lockstep, so a pinned-minor match avoids a duplicate `@smithy` tree. The developer installs with `npm install @aws-sdk/s3-request-presigner@<installed client-s3 version> -w server` and confirms `npm ls @smithy/signature-v4` shows one version. Only `getSignedUrl` is imported.

**The signature.**

- `s = base64url(HMAC-SHA256(secret, "v1\n" + root + "\n" + key + "\n" + e))`, at full length (43 characters).
- `key` is the **decoded, validated** storage-relative key, the same string `isValidKey` checks (`storage.ts:54-64`). The URL is built from it by percent-encoding each segment, the way `illustrationRedirect.ts:32` does. On verify, the request path is decoded once (`decodeURIComponent`; a malformed escape is not a key), checked with `isValidKey`, and must not end in `/`. Only then is the HMAC computed.
- **The root is part of what is signed**, so a link for `/uploads/x` does not verify as `/illustrations/x`.
- Under the `illustrations` root, a key whose first segment is `uploads` is refused. This is defence in depth for the reserved prefix in decision 5.
- **Comparison:** decode `s`. A length other than 32 bytes is rejected before any comparison. Then `crypto.timingSafeEqual`.
- **Expiry:** reject when `e <= now`. Also reject `e > now + 2 × TTL + 60 s`, so a link minted under a longer old TTL dies once the TTL is lowered.
- Unknown query parameters are ignored, so a cache-buster cannot break a link.

**The secret and its configuration.** Everything is read once, at first use, and memoized, with a test-reset hook (the pattern of `getStorage()`, `storage.ts:379-391`).

| Env var | Default | Behaviour |
|---|---|---|
| `MEDIA_URL_SECRET` | none | At least 32 characters. **Production, unset or too short:** a random 32-byte secret for this process, plus one `console.warn` that names the variable and says links break on every restart. It never falls back to unsigned. **Non-production, unset:** a fixed, committed dev constant, so `tsx watch` restarts do not break every image in dev. In `render.yaml` it is `generateValue: true`: Render generates "a randomized, base64-encoded, 256-bit value" when the variable "doesn't already exist" and keeps it across syncs (Render Blueprint spec). |
| `MEDIA_URL_SECRET_PREVIOUS` | unset | Accepted **for verification only**. This is the rotation overlap. `sync: false`. |
| `MEDIA_URL_TTL_MINUTES` | `60` | Integer from 5 to 1440. Anything else falls back to 60 with one warning (the `resolveTokenTtlDays` precedent, ADR-038). |
| `MEDIA_URL_MODE` | `enforce` | `enforce` or `lenient`. Blank means `enforce`. Anything else means `enforce`, plus one warning. **Lenient** serves an unsigned or invalid request exactly as a valid one (disk, then presign), and logs at most one line per minute: `[media] lenient: N unsigned requests in the last minute`, with no keys. **Enforce** answers `403 {"error":"Link expired"}` with `Cache-Control: no-store`. |

The safe fallback for both `MEDIA_URL_MODE` and the secret is the **closed** one. `render.yaml` sets `MEDIA_URL_MODE` with a `value:` entry, `lenient` during rollout and `enforce` from stage 4. A `value:` entry travels with the merge and is reasserted on every Blueprint sync, the `TRUST_PROXY_HOPS` precedent (`render.yaml:64-70`). In an emergency, a dashboard edit to `lenient` works at once and lasts until the next sync.

**Rotation.**
- **Planned:** copy the current value into `MEDIA_URL_SECRET_PREVIOUS`, set a new `MEDIA_URL_SECRET`, and clear `PREVIOUS` after 2 × TTL.
- **Leaked:** set a new secret and leave `PREVIOUS` empty. Every outstanding link dies at once, and clients recover by refetching (decision 4).

### Decision 2: sign outbound in one place; canonicalise inbound

**The choke point.** One Express middleware, `signMediaResponses`, is mounted at `app.use('/api', ...)` ahead of every router in `server/src/index.ts`. It is also added to `createTestApp()` (`server/src/__tests__/setup.ts:89`), which does not mount it today. It wraps `res.json` and copies the body on write:

- It recurses only into plain objects and arrays (Prisma `Date`s and other class instances are left alone), with a depth cap.
- It rewrites a string value only when **its key is one of** `illustration_url`, `cover_url`, `portrait_url`, `style_reference_url` or `url`, **and** the value matches `^/(illustrations|uploads)/`. An already-signed value is canonicalised first and then re-signed, so the rewrite is idempotent.
- Signing needs no request context. The route has already decided what the caller may see: #238's `redactForReader` nulls `style_reference_url` for non-owners before the body gets here.

Matching by key and value, not by value alone, keeps the admin orphan list's `path: "/illustrations/<bookId>"` (`server/src/routes/admin.ts:301,309`) unsigned. `Admin.tsx:21-23` takes the last path segment of it as an id. `/hero/...` frames never match the pattern.

**Every route that emits a media URL.** Verified by grepping `res.json` across `server/src/routes`, and against `docs/conventions/call-graph.md`. All are covered by the one middleware:

| Route | Emits | Site |
|---|---|---|
| `GET /api/books`, `GET /api/books/mine`, `GET /api/books/:id` | `cover_url`, `pages[].illustration_url`, `characters[].portrait_url`, `style_reference_url` | `books.ts:107,124,188` |
| `PUT /api/books/:id/{publish,unpublish}`, `PUT /:id/pages/:n`, `PUT /:id/typography`, `POST /:id/revise`, `PUT /:id/versions/:v/restore` | the same hydrated book | `books.ts:212,239,308,349,546,729` |
| `POST /api/books/:id/illustrate`, `POST /:id/characters/:i/portrait`, `PUT /:id/illustrations/:n/revert` | the same hydrated book | `books.ts:924,1051,1163` |
| `GET /api/books/:id/illustrations/:n`, `GET /:id/characters/:i/portraits` | `[].url` | `books.ts:1103,1083` (from `illustrations.ts:504,604,672`) |
| `GET` and `POST /api/books/:id/narration` | `segments[].url` | `narration.ts:103,140` (from `services/narration/narration.ts:103`) |
| `POST /api/generate` | the hydrated book | `generate.ts:355` |
| `POST /api/uploads/style-reference` | `url` | `uploads.ts:140` |
| `GET /api/admin/books`, `PUT /api/admin/books/:id/{restore,featured,hero-eligible}` | the hydrated book | `admin.ts:144,190,216,261` |

`cart.ts:62-71` and `orders.ts` emit no media (title, price, emoji and colour only). `/api/hero` emits `/hero/...`, which stays public.

**Server-internal consumers read stored rows, so they never see a signed URL.** Unchanged:
- PDF export: `loadImage` reads the row and goes through `getStorage().get()` (`pdf.tsx:124-137`, `:405-406`).
- Re-roll style anchor and portrait references: `resolveStyleAnchor` and `resolveReferenceBytes` (`illustrations.ts:80-117`, `:202-212`), and fal's `toDataUri` (`providers/fal.ts:155-166`).
- Image-pin inference (`imagePin.ts`) and narration lookup (stored keys, `services/narration/narration.ts:55-56`).
- The uploaded style photo is **not** fed to any model after upload. Only its descriptor is (`uploads.ts:105-138`).

**Inbound: the client must never get a signed URL persisted.** There are exactly two write paths that take a media URL from the client (checked against every request schema in `shared/src`):

1. **`PUT /api/books/:id/illustrations/:n/revert`, `url`** (`books.ts:1124-1157`). The client sends back `v.url` from the version list (`BookDetail.tsx:1118`, `BookSpread.tsx:928,1047`), and that value will be signed. Today `history.some(v => v.url === url)` (`books.ts:1147`) would reject it with a 400. **Fix:** compare and store `mediaPath(url)`.
2. **`POST /api/generate`, `styleReferenceUrl`.** The client sends `data.url` from the upload response (`CreateBook.tsx:155,217`), and that value will be signed. It also survives in the sessionStorage draft (`client/src/lib/createDraft.ts:25`). #238 adds `ownStyleReferenceUrl` with the regex `^/uploads/style-refs/<uuid>\.(jpg|png)$`, which would silently null a signed value. **Fix:** apply `mediaPath()` before that regex. **Must follow #238.**

`mediaPath(url)` lives in `shared/src/media.ts`. It strips `?…` and `#…` and returns the path, and the client uses the same function for comparisons. The rule: **outbound is always signed, inbound is always canonicalised**, and the database only ever holds what `mediaPath` returns.

### Decision 3: published books go through the signer too

**Chosen:** one path (open question 2). Seed and demo books, published tester books and drafts are all signed, and served from disk or R2 the same way. Hero frames under `/hero` are not touched.

- **Caching:** links are stable within a window (decision 4), so the storefront grid and a re-opened book hit the browser cache for up to an hour. Across a window boundary, each cover is fetched again once. Covers are full-size PNGs today, so that cost already exists in another form: there are no thumbnails.
- **A book going from public to private:** the API stops returning it to non-owners at once (`books.ts:178-183`). Links already issued keep working until their `e`, at most 2 × TTL. That is the honest guarantee, and the Privacy page copy says so (Task 10).
- **Rejected: keep published art on a stable public path.** The serving handler would need a per-image database lookup to learn the book's status (one Neon round-trip per image, on a free instance that auto-suspends), or a second, public storage prefix that has to be copied on every publish and unpublish. A public custom domain is #192's business.

### Decision 4: expiry, and what the client does about it

**Deterministic windows.** With `W = MEDIA_URL_TTL_MINUTES` (default 60), signing at time `t` gives `e = (floor(t / W) + 2) × W`. Every fetch within one window gets **byte-identical URLs**, so:
- the browser HTTP cache keeps hitting across API refetches,
- `BookSpread`'s module-level `decodedImageUrls` set (`BookSpread.tsx:108-143`) keeps hitting, and
- every link lives between W and 2W.

The R2 presign uses `signingDate = floor(t / W) × W` and `expiresIn = e − signingDate`, so the second hop is deterministic too.

**Response caching.** Valid responses get `Cache-Control: private, max-age=<e − now>`. That covers the 302 under `r2` and the bytes from disk, set through `express.static`'s `setHeaders`. `private` keeps them out of shared caches, including the Cloudflare layer in front of Render (ADR-030). **UNVERIFIED:** whether every browser honours `max-age` on a 302. Where one does not, it costs one extra round trip and nothing else. A 403 is `no-store`.

**Media keys must be immutable.** A key overwritten in place would serve stale bytes for up to 2W. Page art and portraits are versioned (`illustrations.ts:504,672`), and narration keys include the text hash. `cover.png` is written once, at creation (`illustrations.ts:726-728`, called only from `generate.ts:293`). This rule goes into `data.md`.

**Service worker.** `client/pwa.config.ts:38-49` has **no `runtimeCaching` entry**, so the service worker never caches media today. Art and audio are not available offline now, and this change does not make them so. Nothing needs excluding. Task 7 adds a pin to `client/src/__tests__/pwaOptions.test.ts` asserting that no `runtimeCaching` pattern matches `/illustrations/` or `/uploads/`, so a future offline feature cannot cache signed URLs by full URL without meeting this spec. If offline reading is ever wanted, the shape is a Workbox `cacheKeyWillBeUsed` plugin that keys on `mediaPath()`, with a decision on clearing the cache at sign-out. Out of scope.

**Recovery in a long-open tab** (Task 7). There is no React Query; each page holds its own `fetch` state (`BookDetail.tsx:159`, `MyBooks.tsx:22`, `Home.tsx:15`).

- **Detecting expiry:** `mediaExpiresAt(url)` (shared) reads `e`. An unsigned URL returns `null`, which means it never expires. That makes the client safe to ship before the server signs anything.
- **Images:** `useImageFallback` gets one addition. When `onError` fires for a URL whose `e` is within 30 seconds of now or already past, it dispatches `MEDIA_EXPIRED_EVENT` on `window`, **at most once per URL** (a module-level `Set`), and otherwise behaves as today: the fallback shows. `FallbackImage` and `BookSpread` inherit this.
- **Pages:** `BookDetail`, `MyBooks` and `Home` listen for the event and refetch, **at most once per 30 seconds**. They also refetch when the tab becomes visible and the earliest `e` among their media is already past. The refetch returns new URLs, the hook sees a new URL, and it tries again. This mirrors the `AUTH_EXPIRED_EVENT` pattern (ADR-038).
- **No loop:** a URL can fire the event only once. If the refetch returns the same URL, for example because the client's clock runs ahead, nothing else fires and the placeholder stays. Reloading the page fixes it.
- **Version history:** `v.url === page.illustration_url` (`BookSpread.tsx:912`, `BookDetail.tsx:1102`) becomes `mediaPath(v.url) === mediaPath(page.illustration_url)`. Two lists fetched on either side of a window boundary otherwise lose the "current" marker.
- **Audio** (`client/src/lib/narration/generatedProvider.ts`): clips are cached for the provider's lifetime in `ready` (`:117`, `:141`, `:287`). Before playing from a cached entry, treat it as stale if its first segment's `e` is less than 2 minutes away, and refetch it. That `GET` is free; it never calls fal or touches spend (`narration.ts:78-80`). If `el.onerror` fires (`:261`) on a clip whose `e` has passed, drop the entry, refetch once and resume at the same index. A second failure takes today's `failWith('synthesis-failed')` path, which falls back to the device voice (ADR-035). Each clip is one short per-sentence WAV, so a clip expiring mid-playback is not a realistic case. The next-clip preloader (`:268-273`) uses the same fresh entry.
- **Creation wizard:** the style-photo preview (`CreateBook.tsx:340-343`) goes through `useImageFallback`. A draft restored after its link expired shows the text "Style picture attached" instead of a broken image. There is nothing to refetch, and submitting still works because `/api/generate` canonicalises the value (decision 2).

### Decision 5: style-reference uploads behind the storage seam

- **A second store, the same seam.** `getUploadStorage(): StorageBackend` in `storage.ts`.
  - Under `local`, it is `new LocalStorage(UPLOADS_DIR)`, rooted at `server/public/uploads`. Keys look like `style-refs/<uuid>.jpg`, so on-disk paths and existing dev files are unchanged.
  - Under `r2`, it is an `R2Storage` with a new optional `keyPrefix: 'uploads/'`, applied to every S3 key, and a fallback to local disk.
  - One bucket and one credential set; no new env var.
- **The stored URL is unchanged:** `/uploads/style-refs/<uuid>.<ext>`, which #238's regex still matches.
- **`uploads` is a reserved top-level key in the shared bucket.**
  - The admin orphan scan groups keys by first segment (`admin.ts:286-292`). Without a change it would list `uploads` as an orphan "book", and `DELETE /api/admin/orphan-illustrations/uploads` would wipe every photo.
  - Task 6 skips `uploads` in the scan and has the DELETE return 400 for it.
  - The illustrations verifier refuses `uploads/...` keys (decision 1).
  - Book ids are UUIDs or seed slugs (`server/src/seed/canonicalBooks.ts`), so no book can collide with the reserved name.
- **The upload route** (`uploads.ts:92-97`, after #238) calls `getUploadStorage().put('style-refs/<uuid>.<ext>', strippedBytes, sniffedType)` in place of `mkdir` plus `writeFile`. The bytes are the **output of #238's `stripImageMetadata`**, so EXIF is gone before anything is stored. Ordering: **after #238 merges.** The two changes touch the same lines.
- **Serving:** `/uploads` gets the same verifier and handler as `/illustrations` (root `uploads`). On a disk miss under `r2`, it presigns `uploads/<key>`.
- **Existing prod files and rows.** Render's disk is ephemeral (`render.yaml:9-12`), so every photo uploaded in prod has already been lost at the first spin-down after its upload. There is nothing to migrate. Existing rows keep their `/uploads/...` value and 404, and nothing renders them (decision 2). The owner can count them with Neon SQL: `SELECT count(*) FROM "Book" WHERE style_reference_url IS NOT NULL;` (**UNVERIFIED count**).

### Decision 6: rollout, ordered so prod never shows a broken image

**The bucket goes private last.** Old `r2.dev` URLs that have already leaked keep working until stage 5, and nothing earlier can revoke them.

| Stage | What ships | Who | Rollback |
|---|---|---|---|
| **1. Serve path moves to presign; URLs unchanged** | Tasks 1 to 4: `MEDIA_URL_MODE=lenient` and `MEDIA_URL_SECRET` (`generateValue`) in `render.yaml`. Every request is still unsigned, so lenient serves it through disk, then presign. Nothing in the code reads `R2_PUBLIC_BASE_URL` any more (it becomes optional). | Developer; owner merges | Revert the PR. Serving goes back to the 302 to `r2.dev`, which still works because the bucket is still public. |
| **2. URLs become signed, still lenient** | Task 5 (server), plus Tasks 6 and 7. Old clients render signed URLs as-is; inbound canonicalisation (Task 2) has already shipped. | Developer; owner merges | Revert Task 5. URLs go back to unsigned. Lenient means nothing failed in between. |
| **3. Verify** | Checklist A below. Wait about 48 hours after the client deploy to Pages (open question 5) and watch the `[media] lenient:` log lines fall. | **Owner** (Render log, browser, `curl`) | Nothing to roll back. |
| **4. Enforce** | Task 9: a one-line `render.yaml` change, `MEDIA_URL_MODE: enforce`. | Developer writes it; **owner** decides when it merges | Immediate: set `MEDIA_URL_MODE=lenient` in the Render dashboard (restarts the service). Durable: revert the PR. |
| **5. Bucket private** | Cloudflare dashboard → R2 → bucket → Settings → Public access → R2.dev subdomain → **Disallow**. Confirm there is no custom domain connected. Then checklist B. | **Owner only** | Re-allow the R2.dev subdomain (instant). No code is involved. |

**Order of stages 4 and 5.** They are independent. After stage 1, nothing the server sends points at `r2.dev`, so stage 5 is safe any time after stage 1 has been verified. Enforce comes first here only because the owner asked for the bucket to go private last. If stage 4 stalls on old clients, doing stage 5 first closes the bucket half of the hole sooner.

**Checklist A, after stage 2 (owner).**
1. The Render deploy log shows no `MEDIA_URL_SECRET` warning and no `STORAGE_BACKEND=r2 requires` error.
2. In a browser, signed in, open one of your **private** books. Every page, the cover, the portraits, the version strip and read-aloud (generated voice) load. In dev tools, image URLs end in `?e=…&s=…`, and an image request shows `302` with a `Location` on `*.r2.cloudflarestorage.com` carrying `X-Amz-` parameters.
3. Copy one page's signed URL. `curl -sI '<api>/illustrations/<bookId>/<file>?e=…&s=…'` answers `302`, and following it answers `200 image/png`.
4. **Range:** run `curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-99' '<presigned Location of a narration .wav>'`. It should print `206`. In the reader, seek within a generated-voice clip.
5. Load a seed book, such as `luna-star-garden`. Its art is served from disk with `200` and no redirect.
6. Upload a style photo in the wizard. The preview shows. Restart the service and open the same signed URL again (still within its window): it should still answer, now from R2, which proves the upload survives a restart.

**Checklist B, after stages 4 and 5 (owner).**
1. **An unauthenticated fetch of a private book's old URL fails:** `curl -sI '<api>/illustrations/<privateBookId>/page-1-v1.png'` (no query) answers **`403`**.
2. The same URL with an expired or edited `e`, or a changed `s`, answers `403`.
3. The **old `r2.dev` URL** for that key, `https://pub-<hash>.r2.dev/<bookId>/page-1-v1.png`, no longer returns the image. **UNVERIFIED:** which status Cloudflare returns (expected 401, 403 or 404).
4. Checklist A items 2 to 5 still pass. This proves presigned GETs work with public access disabled.
5. Leave a private book open in a tab for more than 2 hours, then turn a page. The art reloads by itself (Task 7 recovery). If it shows placeholders, reload once and file a bug.
6. Delete a test book. Within 2 hours, its previously copied signed URL stops working.

### Amendment 2026-11-17: per-IP rate limit on the media routes

**Why.** CodeQL alert #41 (`js/missing-rate-limiting`, high, merge-blocking under the ruleset) flagged `/illustrations` and `/uploads` once the signature gate made them look like "authorization in front of a disk read". The repo's own limiter (`rateLimit.ts`) keys on the signed-in user and cannot serve `<img>`/`<audio>` requests, which carry no auth. The owner chose to add a real limiter over dismissing the alert (PR #244, 2026-11-17).

**Decision.**
- New dependency `express-rate-limit`, pinned to `8.7.3` (owner-approved in chat). It brings one transitive package, `ip-address`.
- One limiter, created in `mountMedia` and shared by both roots, so a client has one budget for all media. It runs **before** the signature gate, so a flood of bad links costs the same as a flood of good ones.
- Keyed on `req.ip` with IPv6 reduced to a /64 (`ipv6Subnet: 64`), matching `authRateLimit.ts`. `req.ip` is only the real client when `trust proxy` is right: prod depends on `TRUST_PROXY_HOPS=3` (`render.yaml`, ADR-030).
- Budget: `MEDIA_RATE_LIMIT_PER_MINUTE`, default **600** per one-minute fixed window. One book is about 20 images plus its narration clips (an audio element can make several Range requests per clip), and a household shares one IP, so the default is about 10 books a minute per address. Anything other than an integer from 60 to 100000 falls back to 600 with one warning, never to "unlimited".
- Over budget: `429 { "error": "Too many requests. Try again in a minute." }` with `Cache-Control: no-store` and the standard `RateLimit` headers.
- In-process memory store, the same single-instance assumption as ADR-018.
- The e2e API server sets `MEDIA_RATE_LIMIT_PER_MINUTE=100000`: the whole suite loads images from one loopback address.

**Not changed.** The signature design, the gate order (gate, then disk, then presign), and every other decision above.

## Schema / contract changes

- **Prisma:** none.
- **`@storybook/shared` Zod schemas:** none. A new non-schema module, `shared/src/media.ts`, exports `MEDIA_EXPIRES_PARAM = 'e'`, `MEDIA_SIG_PARAM = 's'`, `MEDIA_ROOTS = ['illustrations', 'uploads']`, `mediaPath(url)` and `mediaExpiresAt(url)`. It is re-exported from `shared/src/index.ts`.
- **Response values:** each media string gains `?e=<int>&s=<43 base64url chars>`. The field names, types and nullability are unchanged. The existing route tests pin field presence with `toMatchObject`, and **about 10 assertions compare exact URLs** (`server/src/routes/__tests__/books.test.ts:682,733,744,782,797,803`, and others found by grep). Those move to `mediaPath(res.body…)`. They are edited, not deleted.
- **New server endpoints:** none. `/illustrations/*` and `/uploads/*` change behaviour (decision 1).
- **Env:** `MEDIA_URL_SECRET`, `MEDIA_URL_SECRET_PREVIOUS`, `MEDIA_URL_TTL_MINUTES`, `MEDIA_URL_MODE` are added. `R2_PUBLIC_BASE_URL` becomes optional and unused; it is tolerated if set and dropped from the required list in `storage.ts:213-219`.

## Files likely touched

- `shared/src/media.ts`, `shared/src/index.ts`: canonicalisation and expiry helpers
- `server/src/lib/mediaUrl.ts`: secret, TTL and mode resolution; `signMediaPath`, `verifyMediaRequest`
- `server/src/middleware/media.ts`: `mountMedia(app)` (verifier → `express.static` → presign redirect, for both roots) and `signMediaResponses`. Replaces `server/src/middleware/illustrationRedirect.ts`.
- `server/src/services/storage.ts`: `R2Storage.presignGet`, the `keyPrefix` option, `getUploadStorage()`, `R2_PUBLIC_BASE_URL` made optional
- `server/src/index.ts`, `server/src/__tests__/setup.ts`: mounts
- `server/src/routes/books.ts` (revert canonicalisation), `server/src/routes/generate.ts` (style-ref canonicalisation), `server/src/routes/uploads.ts` (seam), `server/src/routes/admin.ts` (reserved prefix)
- `server/package.json`, `package-lock.json`: the new dependency
- `render.yaml`, `server/.env.example`
- `client/src/hooks/useImageFallback.ts`, `client/src/lib/mediaRefresh.ts` (new: event plus throttle), `client/src/pages/{BookDetail,MyBooks,Home,CreateBook}.tsx`, `client/src/components/BookSpread.tsx`, `client/src/lib/narration/generatedProvider.ts`, `client/src/__tests__/pwaOptions.test.ts`
- `e2e/tests/mobile/media-expiry.spec.ts` (new)
- Docs (Task 10): `docs/conventions/{data,server,client,call-graph}.md`, `CLAUDE.md`, `docs/deploy-spike-render.md`, `client/src/pages/Privacy.tsx` (copy)

## Success criteria

- No API response contains a media path in an allowlisted field without `e` and `s`. A sweep test over every route in the table above enforces this.
- Under `enforce`, `GET /illustrations/<key>` and `GET /uploads/<key>` answer 403 without a valid, unexpired signature. With one, they answer 200 (disk) or 302 (R2 presign).
- Under `lenient`, every request is served, signed or not.
- `PUT …/revert` with a signed `url` succeeds and stores the unsigned path. `POST /api/generate` with a signed `styleReferenceUrl` stores the unsigned path.
- Two fetches within one window return identical URLs.
- A Playwright spec shows an expired image recovering without a reload, in both themes at a mobile viewport.
- The PDF export, re-rolls, portraits and narration lookups behave exactly as before; their existing tests pass unedited.
- Checklists A and B pass in prod (owner).

## Out of scope

- **#192:** pruning superseded versions, and a custom domain in front of R2. A custom domain cannot serve presigned URLs anyway (Cloudflare docs). Nothing here depends on it.
- Offline reading of art or audio, and any service-worker media cache.
- `no-store` for private art (open question 4 alternative).
- Deleting R2 objects when a book is soft-deleted. Enforcement already makes them unreachable once their links expire.
- Hero frames (`/hero`), which stay public by ADR-014 and ADR-016.
- A read-only R2 token used only for presigning (least privilege). Worth doing later; today one token signs both reads and writes.
- Not storing style photos at all (open question 3 alternative). It would get its own small spec.
- Per-user identity on media requests (cookies). It would be a session-model change (guardrail) and is not needed for capability links.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| A new route emits a media URL under a key the signer does not know | The key allowlist covers every field name in `shared/src`. The sweep test fails on any unsigned `/illustrations/` or `/uploads/` value in **any** field except the admin orphan `path`. |
| Signed URL persisted through a write path | Inbound `mediaPath()` on both write paths (Task 2), plus idempotent re-signing on the way out. A test writes a signed value and reads back the bare path from the database. |
| `createTestApp` drifts from `index.ts` | Both call one exported `mountMedia(app)` and mount `signMediaResponses` the same way. A harness-style test asserts `index.ts` calls `mountMedia`. |
| Old clients after enforce | Lenient window of at least 48 hours (open question 5). The immediate dashboard rollback in stage 4. |
| Server restart without a stable secret | `generateValue: true` in `render.yaml`. A startup warning in prod if unset. Clients recover by refetching. |
| Clock skew between client and server | The client uses `e` only as a hint. Recovery is triggered by an actual load error and bounded to once per URL. |
| `tsx watch` restarts in dev changing the secret | A fixed dev secret when not in production. |
| Paid API exposure | None. Recovery refetches only free `GET`s (`/api/books/*`, `GET /api/books/:id/narration`). The e2e spec route-mocks nothing paid and calls no paid route. |
| Auth/session guardrail | Not touched. No token, header or `storybook-session` change. Media links are capability URLs **beside** the session model, not part of it. The PR body says so. |
| Dark-mode parity | The only new UI is the "Style picture attached" text in `CreateBook`. It needs `dark:` variants. |
| `express.static` sets `Cache-Control: public, max-age=0` by default | Overridden in `setHeaders` for signed responses. A test pins the header. |
| Existing `illustrationRedirect.test.ts` asserts an `R2_PUBLIC_BASE_URL` Location | Ported to the new module and rewritten to assert a presigned Location. The behaviour change is approved by this spec, not a test deleted to get green. |

## Test strategy

**Server** (Vitest + Supertest; `cd server && npm test`; one server-zone agent at a time):
- `lib/__tests__/mediaUrl.test.ts`: round trip; byte-identical within a window and different across one; `e` boundaries; a tampered `s`, `e`, key or root fails; `..`, a leading `/`, `%2e%2e` and a malformed escape all fail; a wrong-length `s` fails before compare; `PREVIOUS` verifies and is never used to sign; the secret, TTL and mode fallbacks (unset or malformed, prod and dev, warn once, never logging a value).
- `middleware/__tests__/media.test.ts`: the `local` root serves 200 with a `private, max-age` header; 403 plus `no-store` under enforce; 200 for unsigned under lenient; `/uploads` the same; `uploads/` refused under `/illustrations`; HEAD; Range gives 206 from disk; under `r2` with `getSignedUrl` mocked (`vi.mock('@aws-sdk/s3-request-presigner')`), a 302 to the mocked URL, with `signingDate` and `expiresIn` asserted and the key carrying its prefix for `/uploads`.
- `middleware/__tests__/signMediaResponses.test.ts`: allowlisted keys signed, `path` untouched, `Date` untouched, idempotent, depth cap.
- Route tests: `toMatchObject` wire-shape pins with `expect.stringMatching(SIGNED_ILLUSTRATION_RE)` on `GET /api/books/:id`, `/mine`, the list route, `/illustrations/:n`, `/portraits`, `GET /narration`, `/api/admin/books` and the upload response. Plus the sweep test, and the two inbound canonicalisation tests.
- Upload seam: `getUploadStorage()` local round trip; the R2 key prefix with a mocked `S3Client`; the orphan scan skips `uploads`; `DELETE …/orphan-illustrations/uploads` returns 400.
- `render.yaml` test (beside `rateLimitScope.test.ts`): it declares `MEDIA_URL_SECRET` with `generateValue: true` and `MEDIA_URL_MODE` with a valid value.

**Client** (Vitest + RTL; `cd client && npm test`):
- `useImageFallback`: an expired signed URL dispatches the event once; a non-expired one and an unsigned one do not.
- Each page refetches on the event, at most once per 30 seconds, and on a visible tab with a past `e`.
- Version strip: the current marker stays across differing signatures.
- `generatedProvider`: a stale cache entry is refetched; `onerror` on an expired clip refetches once, then fails as today.
- `CreateBook`: the attached-photo fallback text.
- `pwaOptions`: no media `runtimeCaching`.

**E2E** (Playwright; `cd e2e && npm test`):
- `mobile/media-expiry.spec.ts`, inside `forEachTheme` at a mobile viewport. The first `GET /api/books/<seed id>` is route-rewritten (`times: 1`) so `illustration_url` carries a past `e` and a junk `s`. The real server answers 403 (e2e runs `enforce`, the code default). The image recovers to a real signed URL with no reload. Then `expectNoHorizontalOverflow` and `expectTapTargets`. This claims the **correctness** half of Done criterion 2 (ADR-009).
- A request-level test: an unsigned `/illustrations/<seed key>` answers 403.
- Existing specs mock media with `data:` URIs or route stubs (`e2e/tests/_editPublished.ts:34`, `illustration-history.spec.ts:95`, `narration-generated.spec.ts:162`), and must stay green. **UNVERIFIED:** whether `narration-generated.spec.ts:162`'s glob `**/illustrations/*/narration/*.wav` still matches. It stubs the narration JSON with unsigned URLs, so it should be unaffected. Task 8 confirms.

**Not tested:** live R2 (Task 4 mocks it; checklists A and B are the real check), live fal and Anthropic (never tested here).

## ADR-worthy decisions

Next free number is ADR-039.

- [ ] **Media is served through HMAC-signed, expiring links verified by the server for every backend; under `r2` a disk miss 302s to a short presigned R2 GET.** Supersedes ADR-026. Main alternative rejected: presigned R2 URLs straight in the API JSON (breaks the disk fallback for seed art, and puts the R2 host in responses).
- [ ] **Signing happens at one choke point, a `res.json` wrapper on `/api` that rewrites allowlisted media fields; inbound media URLs are canonicalised with a shared `mediaPath()`; stored URLs stay unsigned.** Amends ADR-025. Main alternative rejected: signing in each serialiser (about 25 `res.json` sites, easy to miss).
- [ ] **Published books use the same signed links; there is no public media path.** Amends ADR-026's "the art is already public". Main alternative rejected: a stable public path or custom domain for published art (a per-image database lookup, or copying on publish).
- [ ] **Expiry is window-bucketed and deterministic (`MEDIA_URL_TTL_MINUTES`, default 60, links live 1 to 2 windows); the client recovers with a bounded, event-driven refetch.** Main alternative rejected: per-request expiry (defeats every cache layer).
- [ ] **`@aws-sdk/s3-request-presigner` is added at the `client-s3` minor.** Amends ADR-027's "no presigner". Main alternative rejected: hand-rolled SigV4 on the undeclared transitive `@smithy/signature-v4`.
- [ ] **Style-reference uploads go through the storage seam under the reserved top-level prefix `uploads/` in the same bucket.** Amends ADR-025's "`public/uploads` is not behind the seam". Main alternative rejected: a second bucket (more owner setup and more env vars, for isolation the reserved prefix already gives).
- [ ] **Media routes get a per-IP limiter (`express-rate-limit`, 600 requests per minute per address by default, ahead of the signature gate).** Added 2026-11-17 for CodeQL alert #41. Main alternative rejected: dismissing the alert as a false positive (the owner preferred a real bound on anonymous disk reads).
- [ ] **`MEDIA_URL_SECRET` is Render-generated; when unset it falls back to a random per-process secret in prod and a fixed constant in dev, and never to unsigned. `MEDIA_URL_MODE` defaults to `enforce`.** Main alternative rejected: refusing to boot when the secret is unset (it would take a live service offline over a drifted env var, against the `cors.ts` precedent).
