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
import Anthropic from '@anthropic-ai/sdk';
import { checkForNewerModel } from './lib/models';
import { buildCorsPolicy } from './lib/cors';

import type { Request, Response, NextFunction } from 'express';

const app = express();
const PORT: number = parseInt(process.env.PORT || '3001', 10);

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
});
