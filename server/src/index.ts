// loadEnv must be first — it populates process.env (incl. DATABASE_URL)
// before any other import instantiates the Prisma client.
import './loadEnv';

// Allow self-signed certs behind a corporate proxy. This disables TLS
// certificate validation for EVERY outbound request the server makes —
// including the ones carrying API keys to Anthropic and Fal — so it must never
// be on in production. It previously ran unconditionally and shipped to Render.
//
// Opt in explicitly with ALLOW_INSECURE_TLS=1 when you're behind a proxy that
// needs it; the guard refuses in production regardless.
if (process.env.ALLOW_INSECURE_TLS === '1') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ALLOW_INSECURE_TLS=1 is not permitted when NODE_ENV=production — it would disable TLS certificate validation for outbound API calls.',
    );
  }
  console.warn('[tls] Certificate validation DISABLED (ALLOW_INSECURE_TLS=1). Development only.');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import express from 'express';
import cors from 'cors';
import { join } from 'path';
import authRouter from './routes/auth';
import booksRouter from './routes/books';
import generateRouter from './routes/generate';
import cartRouter from './routes/cart';
import ordersRouter from './routes/orders';
import uploadsRouter from './routes/uploads';
import adminRouter from './routes/admin';
import heroRouter from './routes/hero';
import testRouter from './routes/test';
import { snapshotDb } from './db/snapshot';
import { bootstrapAllowlist } from './services/allowlist';
import { reconcileAdmins } from './services/adminBootstrap';
import { backfillUserEmails } from './services/emailBackfill';
import Anthropic from '@anthropic-ai/sdk';
import { checkForNewerModel } from './lib/models';
import { buildCorsPolicy } from './lib/cors';
import { assertSingleInstanceAssumption } from './middleware/rateLimit';

import type { Request, Response, NextFunction } from 'express';

const app = express();
const PORT: number = parseInt(process.env.PORT || '3001', 10);

// Rate limiting is in-process, so its guarantee is only as wide as one instance
// (ADR-018). Checked at boot rather than per-request: the answer cannot change while
// the process runs, and a 500th-request discovery is not a discovery.
assertSingleInstanceAssumption();

const corsPolicy = buildCorsPolicy();
if (corsPolicy.warning) {
  console.warn(`[cors] ${corsPolicy.warning}`);
} else if (corsPolicy.allowed.length > 0) {
  console.log(`[cors] restricted to: ${corsPolicy.allowed.join(', ')}`);
}
app.use(cors(corsPolicy.options));
app.use(express.json({ limit: '10mb' }));
app.use('/illustrations', express.static(join(import.meta.dirname, '../public/illustrations')));
app.use('/uploads', express.static(join(import.meta.dirname, '../public/uploads')));
// Derived, committed, byte-budgeted hero-rotation frames. Unlike /illustrations these
// are never written at runtime -- they are produced by server/scripts/derive-hero-frames.sh
// and committed. server/src/__tests__/heroFrameAssets.test.ts is the budget gate.
app.use('/hero', express.static(join(import.meta.dirname, '../public/hero')));

app.use('/api/auth', authRouter);
app.use('/api/books', booksRouter);
app.use('/api/generate', generateRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/admin', adminRouter);
// Public and unauthenticated on purpose — see the header comment in routes/hero.ts.
app.use('/api/hero', heroRouter);

// Test-only routes for cleaning up state left by E2E specs. Mounted only
// outside production; the handlers themselves also enforce a NODE_ENV check.
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/_test', testRouter);
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Final error handler. Express recognises this as an error middleware
// because of the four-arg signature — do NOT drop `_next` even though
// it's unused on the response path.
//
// Express 5 awaits async handlers and forwards a rejection here, so an
// error escaping a route's try/catch now lands on this handler and the
// caller gets a 500 envelope. Under Express 4 the same rejection hung the
// request indefinitely and the client saw the `Unexpected end of JSON
// input` empty-body symptom — that failure mode is gone, but this handler
// is what turns the rejection into a response, so it is still required.
//
// We deliberately do NOT leak err.message or err.stack to the client —
// callers get a generic envelope, the full detail is in the server log.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction): void => {
  console.error('[express:error]', err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Best-effort backup of dev.db on every server start. Quiet on failure.
  void snapshotDb();

  // Advisory: report if a newer Sonnet has shipped. Never changes the model.
  if (process.env.ANTHROPIC_API_KEY) {
    void checkForNewerModel(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
  }

  // Seed the registration allowlist from ALLOWLIST_BOOTSTRAP_EMAILS if it's
  // empty, so a fresh deployment isn't locked out of its own signup. No-ops
  // once the table has any row. Failure is logged, never fatal — a server that
  // won't boot is worse than one whose allowlist needs a manual entry.
  void bootstrapAllowlist()
    .then(seeded => {
      if (seeded.length > 0) {
        console.log(`[allowlist] bootstrapped ${seeded.length} email(s): ${seeded.join(', ')}`);
      }
    })
    .catch((err: unknown) => console.error('[allowlist] bootstrap failed', err));

  // Converge User.email onto its lowercase form before anything else reads a
  // user row. Rows registered before the auth path normalized on write can hold
  // mixed case, which the fixed /login lookup would never find. Idempotent:
  // once converged this is one query and zero writes on every later boot.
  // Collisions are resolved in application code and reported, never merged.
  //
  // reconcileAdmins() is chained off this rather than fired alongside it —
  // both write User rows, and one sequence is cheaper to reason about than two
  // racing void blocks. It runs from .finally, not .then, so a failed backfill
  // still cannot cost the deployment its admin.
  // backfillUserEmails() does its own reporting, same as reconcileAdmins()
  // below, so this block only handles failure — otherwise every collision
  // printed twice at boot.
  void backfillUserEmails()
    .catch((err: unknown) => console.error('[email-backfill] failed', err))
    .finally(() => {
      // Reconcile admin roles against ADMIN_BOOTSTRAP_EMAILS. Unlike the
      // allowlist bootstrap above, this runs on EVERY boot: the env var is the
      // source of truth, so removing an address demotes that admin on the next
      // restart. Unset, blank, or unparseable is a total no-op.
      // reconcileAdmins() does its own reporting — promoted, demoted, and
      // not-yet-registered each log there — so this block only has to handle
      // failure. Logged, never fatal: a server that will not boot is worse than
      // one whose admin needs another restart.
      //
      // Independent of the allowlist bootstrap on purpose; neither reads the
      // other's result, and being promotable does not imply being allowed to
      // register.
      void reconcileAdmins().catch((err: unknown) =>
        console.error('[admin-bootstrap] reconcile failed', err),
      );
    });
});
