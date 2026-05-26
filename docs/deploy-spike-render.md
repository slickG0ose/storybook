# Deploy Spike — Render + GitHub Pages

**Date:** 2026-05-26
**Status:** Deploy-ready prep (artifacts in this PR; nothing live yet)
**Tracks:** Follow-up to [GH #4 — F3 research](https://github.com/slickG0ose/storybook/issues/4); preparation for [GH #7 — F5 demo deploy](https://github.com/slickG0ose/storybook/issues/7)

This document is the click-by-click for taking the artifacts in this branch and turning them into a live demo. The goal is to validate the "free hosting + GitHub Actions native + scalable without rework" path from the research doc.

## What's in this PR

| Artifact | Purpose |
|---|---|
| `render.yaml` | Render Blueprint — defines the Express web service + free Postgres DB |
| `.github/workflows/deploy-pages.yml` | Builds `client/` with `VITE_API_BASE_URL` baked in, deploys to GitHub Pages. Manual-trigger only until prereqs are met |
| `.github/workflows/deploy.yml` | Existing placeholder, updated comment to reference this doc |
| `client/src/lib/apiBase.ts` | Tiny helper exporting `api(path)` that prepends `VITE_API_BASE_URL` (empty in dev) |
| `client/**` (33 fetch sites + 8 img src sites) | All `/api/*` calls and image references now go through `api()` |
| `client/.env.example` | Documents `VITE_API_BASE_URL` |
| `server/prisma/schema.postgresql.prisma` | Postgres variant of the SQLite schema, identical models |
| `server/prisma/gen-postgres-schema.mjs` | Idempotent generator that produces the Postgres variant from the SQLite source |
| `server/package.json` | New `db:gen-postgres-schema` script |
| `server/.env.example` | Documents the Postgres `DATABASE_URL` for deploy contexts |

**Nothing in this PR is wired up to run automatically.** The Pages workflow is `workflow_dispatch`-only. The Render Blueprint sits inert until you connect the repo. Merging this PR has zero observable effect.

## What this spike does NOT do

- No actual Render account creation. That's a manual step (below).
- No actual deploy. Same — you click the button when ready.
- No `VITE_BASE_PATH` / React Router basename handling for project-page paths (`username.github.io/repo`). See "Known issues" below; recommendation is to use an org root or custom domain to sidestep.
- No persistent-disk story for runtime-generated illustrations. Render free has ephemeral filesystem. Demo-seed PNGs survive (committed). Newly-generated ones get lost on restart. See "Known issues."
- No CORS lockdown. Server's `cors()` middleware stays wide-open. Fine for spike, tighten for prod.

## Prerequisites (your accounts / settings)

Before clicking deploy:

1. **A Render account.** Sign up at https://render.com — free tier, GitHub OAuth. No credit card required for the free plan.
2. **Repo connection.** During Render onboarding, grant Render access to the `slickG0ose/storybook` repo (or just-this-repo scope).
3. **GitHub Pages enabled.** Repo Settings → Pages → Source: **GitHub Actions** (not "Deploy from a branch").
4. **One repo Action secret** set under Settings → Secrets and variables → Actions:
   - `VITE_API_BASE_URL` — the Render web service URL (you'll fill this in after step 1 of deploy below; it's predictable like `https://storybook-server.onrender.com`).
5. **Two Render environment variables** set in the Render dashboard after the Blueprint creates the service:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`

## Deploy click-by-click

### Step 1 — Deploy the server + DB via Render

1. Sign in to Render dashboard.
2. Click **New > Blueprint**.
3. Pick the `slickG0ose/storybook` repo when prompted.
4. Render detects `render.yaml` at the repo root and previews two services: `storybook-server` (web) + `storybook-postgres` (database).
5. On the preview page, Render asks for the `sync: false` env vars — paste your Anthropic and OpenAI keys.
6. Click **Apply**. Render provisions both services. First deploy takes 3–6 min (build + migrate + start).
7. Once green, the web service URL is shown — typically `https://storybook-server.onrender.com`. Copy it.
8. Open the URL — you should see whatever the root path renders (currently no static index on root; `GET /api/health` should return `{"status":"ok"}`).

**If the Blueprint preview shows a build command that doesn't match `render.yaml`** (e.g., extra lines, missing flags, drifted from the file on disk), use **Sync Blueprint** in the Render dashboard to re-apply `render.yaml` over any manual dashboard edits. Manual overrides in the dashboard win over render.yaml until you sync.

### Step 2 — Wire up GitHub Pages

1. In the repo on GitHub, go to **Settings > Pages**. Set Source to **GitHub Actions**.
2. Go to **Settings > Secrets and variables > Actions > New repository secret**.
3. Name: `VITE_API_BASE_URL`. Value: the Render URL from Step 1.7. Save.

### Step 3 — Trigger the Pages deploy

1. Go to the repo's **Actions** tab.
2. Pick the **Deploy client to GitHub Pages** workflow.
3. Click **Run workflow** > branch `master` > **Run workflow**.
4. Wait ~2 min. The workflow builds the client with the secret injected at build time, uploads the dist as a Pages artifact, deploys.
5. Visit the URL Pages shows (typically `https://slickG0ose.github.io/storybook/`).

### Step 4 — Verify the round-trip

Open the deployed client URL. Smoke-test:

- **Browse** — Home loads, featured/community books render, theme + age filters work
- **Auth** — register a new account, log in. The session cookie should set against the Render domain.
- **Create** — generate a book end-to-end. This exercises Anthropic (story gen) and OpenAI (illustrations) through the Render server.
- **Cart + checkout** — add to cart, complete checkout, see the order confirmation

If anything fails, see **Common issues** below.

### Step 5 (optional) — Enable auto-deploy on push

Once Step 4 is green and you trust the pipeline, uncomment the `push` block in `.github/workflows/deploy-pages.yml`:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [master]
    paths:
      - 'client/**'
      - 'shared/**'
      - 'package-lock.json'
      - '.github/workflows/deploy-pages.yml'
```

Render's GitHub integration already auto-deploys the server on push to `master`.

## Gotchas surfaced during the first real deploy attempt (fixed)

These three bugs hit on the first attempt to apply the Blueprint. All three are fixed in render.yaml as of commit on this branch — calling out so future sessions don't re-introduce them.

1. **`NODE_ENV=production` killed devDeps at build time.** Render evaluates env vars during build, so `NODE_ENV=production` made `npm ci` skip all devDeps. The server runs TypeScript directly via `tsx` (a devDep) at startup — without it, the server crashes before binding the port. Fix: `npm ci --include=dev` in the build command.

2. **Shell state leaked across YAML literal-block lines.** The original buildCommand had `cd server && ...` on two separate lines. Render runs the literal block as a single bash script, so the working directory from line 2 persisted into line 3, and the second `cd server` tried to enter `server/server/` which doesn't exist. Fix: chain `cd server && cmd1 && cmd2` on one logical line.

3. **Node version drift.** Render defaulted to Node 24 (bleeding edge); the rest of the stack (CI workflow, local dev) is on Node 22. Fix: explicit `NODE_VERSION: '22'` env var in render.yaml.

If you see `bash: line N: cd: server: No such file or directory` in a build log after future schema changes, you've likely re-introduced bug #2.

## Known issues / limitations

### 1. Runtime-generated illustrations don't survive restarts (BLOCKER for a real beta)

Render free web service has **ephemeral filesystem** — no persistent disk on the free plan. The server writes generated PNGs to `server/public/illustrations/{book-id}/page-N.png`. On the next restart (deploy, crash, or 15-min-idle spin-down + cold-start), those files are gone.

Committed demo-seed PNGs (the "A Spot for Sunny" book) ship in the deploy bundle, so they survive. Newly-generated books will lose their illustrations and need re-generation.

**Workarounds:**
- **Accept it for spike.** Users re-generate after each restart. Annoying but free.
- **Persistent disk** ($1/GB-mo on Render's paid plans, 1GB minimum).
- **Blob storage** — Cloudflare R2 (zero egress, $0.015/GB-mo storage), S3, or Cloudinary (free 25GB tier). Requires code changes in `server/src/services/illustrations.ts` to write to the bucket instead of disk.

Recommendation: ship the spike with the limitation, capture a follow-up issue, decide based on actual beta-user feedback whether to invest in blob storage.

### 2. 15-minute idle spin-down

Render free web service spins down after 15 min of no traffic. First request after spin-down takes ~30s while the machine boots and the Express server starts. After warmup, subsequent requests are fast.

For a beta with sporadic traffic, this is the most user-visible papercut. Options:
- **Accept it.** First-time visitors are warned via a quick "loading" state.
- **Cron-ping the health endpoint** every 14 min from a free Cron service (cron-job.org, GitHub Actions schedule, UptimeRobot). Keeps the machine warm at the cost of always-on free-tier resources.
- **Upgrade to Starter** ($7/mo Render) — no spin-down.

### 3. Free Postgres expires after 90 days

Render's free Postgres has a hard 90-day lifetime. After that, you upgrade to a paid plan ($7/mo at time of writing) to keep your data, or the DB is deleted. Calendar this from day-one deploy.

**Migration alternatives if you don't want to pay Render:**
- **Neon** has a real persistent free tier (0.5 GB storage, 100 CU-hr/month, autosuspend after 5 min idle). Swap by changing `DATABASE_URL` in Render's env vars.
- **Supabase** free tier — 500 MB database. Same swap.
- **PlanetScale** free tier — MySQL, would require Prisma schema changes.

### 4. `prisma db push --accept-data-loss` in the build command

The Blueprint runs `prisma db push --accept-data-loss` on every deploy. First deploy against an empty DB: harmless. Subsequent deploys: any schema change that destructively alters columns/tables will silently lose data.

This is acceptable for a demo where nobody's paying for their content. Before a real beta, switch to a Prisma migrations workflow:
- Generate Postgres-specific migrations once locally: `cd server && DATABASE_URL=postgres://... npx prisma migrate dev --schema=prisma/schema.postgresql.prisma --name init`
- Commit `prisma/migrations-postgresql/` (or wherever)
- Change Blueprint build command to `prisma migrate deploy --schema=prisma/schema.postgresql.prisma`

### 5. GitHub Pages serves at `username.github.io/repo`, not `/`

For `slickG0ose/storybook`, Pages serves at `https://slickG0ose.github.io/storybook/`. Vite's default `base: '/'` and React Router's default basename break under that path — built assets reference `/assets/...` (absolute) and the router doesn't know about the `/storybook` prefix.

**Workarounds (in order of escalating effort):**
- **Use a custom domain** — point a CNAME at Pages. Serves at root.
- **Use the org root site** — `slickG0ose.github.io` (one per user/org). Serves at root. Loses use of that root for any other project.
- **Patch Vite + Router** — set `base: '/storybook/'` in `vite.config.ts` and `basename="/storybook"` on the BrowserRouter. Adds a `VITE_BASE_PATH` env var to keep local dev working at `/`.

This is the single most likely failure mode on first deploy. The Pages workflow build will succeed; the deployed site will load a blank page or 404 on client-routes.

Recommendation: pick a workaround before Step 3, not after.

### 6. CORS is wide-open

`server/src/index.ts` has `app.use(cors())` (no options) → `Access-Control-Allow-Origin: *`. Works for the spike. For prod, tighten to the actual Pages origin:

```ts
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
}));
```

Then set `CORS_ORIGIN` in Render env to `https://slickG0ose.github.io`.

## Cost projection

| Scenario | Render | GitHub Pages | Total/month |
|---|---|---|---|
| Day 1 — Day 90 (Postgres free period) | $0 | $0 | **$0** |
| Day 91+ (Postgres paid) | $7 | $0 | **$7** |
| Day 91+ (Postgres swapped to Neon free) | $0 | $0 | **$0** |
| If you want no spin-down (Starter web) | $7 + $7 | $0 | **$14** |
| If you migrate illustrations to Cloudflare R2 | + ~$0–$2 (storage; egress is free) | — | — |

The path to genuinely-free indefinite hosting is: **Render free web + Neon free Postgres + Cloudflare R2 free for illustrations + GitHub Pages**. Total: $0 indefinitely up to small-beta scale.

## When does this spike's setup break?

This is the "scalability without rework" check from the research doc. Where do the seams crack?

| Stress point | Threshold | What changes |
|---|---|---|
| Render free web CPU | ~512MB / 0.1 CPU | Move to Starter ($7/mo) or migrate to a container host like Fly/Railway |
| Postgres free expiry | Day 90 | Swap `DATABASE_URL` to Neon/Supabase or pay Render |
| Cold-start UX | When sporadic-traffic beta starts complaining | Cron-ping or upgrade to no-spin-down tier |
| Illustration loss on restart | First time a real user generates a book and comes back | Add blob storage |
| GH Pages routing | First page-refresh on `/book/123` returns 404 | Either fix the basename or move off project-page URL |
| CORS hardening | Pre-launch security pass | One-line server change |

None of these force the Express + Prisma + Node app to be rewritten. Each is an operational lever. **The spike's stack is portable**: the server can move to Fly, Railway, Render Starter, or self-hosted Docker without app changes; the client can move to Vercel, Netlify, Cloudflare Pages, or a CDN with `dist/` upload without app changes.

## Follow-up issues to file

After merging this PR:

- [ ] **Implement F5** (demo deploy) — execute the steps above on an actual Render account
- [ ] Decide on the GitHub Pages base-path workaround (custom domain vs org root vs vite/router config)
- [ ] Add `CORS_ORIGIN` env handling to `server/src/index.ts` and document in `server/.env.example`
- [ ] Generate Postgres-specific Prisma migrations and switch the Blueprint from `db push` to `migrate deploy`
- [ ] Decide on illustration persistence strategy (accept-it / Render persistent disk / R2)
- [ ] Calendar the Postgres-free expiry (90 days from deploy)
- [ ] Schema-sync CI check — fail builds if `schema.prisma` changes but `schema.postgresql.prisma` doesn't get regenerated

## Sources

- [Render Blueprint Specification](https://render.com/docs/blueprint-spec)
- [Render Free Tier](https://render.com/docs/free)
- [GitHub Pages with GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow)
- [Vite — Public Base Path](https://vitejs.dev/guide/build.html#public-base-path)
- [Prisma — db push vs migrate deploy](https://www.prisma.io/docs/orm/prisma-migrate/workflows/prototyping-your-schema)
- F3 research doc: [`docs/deploy-stack-research.md`](./deploy-stack-research.md) (PR #30)
