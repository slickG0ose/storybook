import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../validate';

// ---------------------------------------------------------------------------
// Unit tests for the validate() middleware.
//
// These tests build minimal Express apps inline so they don't touch the
// database — they're focused on the middleware behavior itself.
// ---------------------------------------------------------------------------

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('validate() middleware', () => {
  // -------------------------------------------------------------------------
  // Request validation
  // -------------------------------------------------------------------------
  describe('request validation', () => {
    it('passes valid request bodies through to the handler', async () => {
      const Schema = z.object({ name: z.string() });
      const app = express();
      app.use(express.json());
      app.post('/echo', validate({ request: Schema }), (req, res) => {
        res.json({ received: req.body });
      });

      const res = await request(app).post('/echo').send({ name: 'Bolt' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: { name: 'Bolt' } });
    });

    it('returns 400 with a useful error message when the body is invalid', async () => {
      const Schema = z.object({
        name: z.string({ required_error: 'name is required' }),
      });
      const app = express();
      app.use(express.json());
      app.post('/echo', validate({ request: Schema }), (_req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).post('/echo').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('name');
      expect(res.body.error).toContain('required');
    });

    it('coerces / replaces req.body with the parsed value', async () => {
      // Use a transform so we can prove req.body was replaced with parsed data.
      const Schema = z.object({
        count: z.string().transform(v => parseInt(v, 10)),
      });
      const app = express();
      app.use(express.json());
      app.post('/parse', validate({ request: Schema }), (req, res) => {
        res.json({ count: req.body.count, type: typeof req.body.count });
      });

      const res = await request(app).post('/parse').send({ count: '42' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 42, type: 'number' });
    });
  });

  // -------------------------------------------------------------------------
  // Response validation
  // -------------------------------------------------------------------------
  describe('response validation', () => {
    it('allows responses that match the schema', async () => {
      const Schema = z.object({ id: z.string(), label: z.string() });
      const app = express();
      app.get('/item', validate({ response: Schema }), (_req, res) => {
        res.json({ id: 'a1', label: 'hello' });
      });

      const res = await request(app).get('/item');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 'a1', label: 'hello' });
    });

    it('returns a 500 envelope + console.error on response drift in non-prod', async () => {
      // NODE_ENV is 'test' in vitest by default; assert that explicitly.
      expect(process.env.NODE_ENV).not.toBe('production');

      const Schema = z.object({ id: z.string(), label: z.string() });
      const app = express();
      app.get(
        '/drift',
        validate({ name: 'GET /drift', response: Schema }),
        (_req, res) => {
          // Bug: server returns `name` instead of `label` — exactly the class
          // of drift this middleware exists to catch.
          res.json({ id: 'a1', name: 'oops' });
        },
      );

      const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(app).get('/drift');

      // We MUST NOT throw — async handler rejections kill the dev server
      // under Express 4. Drift is loud (500 + console.error) but non-fatal.
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Response shape drift on GET /drift');
      expect(res.body.error).toContain('label');
      expect(consoleErr).toHaveBeenCalled();
      const message = consoleErr.mock.calls[0]?.[0];
      expect(message).toContain('Response shape drift on GET /drift');
      consoleErr.mockRestore();
    });

    it('does not crash the process when drift happens inside an async handler', async () => {
      // Regression for the bug where `throw new Error(...)` inside the patched
      // res.json escaped as an unhandledRejection because Express 4 does not
      // forward async handler rejections to the default error middleware.
      // Repro: an async handler that calls res.json with a drifting payload.
      expect(process.env.NODE_ENV).not.toBe('production');

      const Schema = z.object({ id: z.string(), label: z.string() });
      const app = express();
      app.get(
        '/drift-async',
        validate({ name: 'GET /drift-async', response: Schema }),
        async (_req, res) => {
          await Promise.resolve();
          res.json({ id: 'a1', name: 'oops' });
        },
      );

      const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      const rejectionHandler = vi.fn();
      process.on('unhandledRejection', rejectionHandler);

      const res = await request(app).get('/drift-async');

      // Yield to the event loop so any pending unhandledRejection would fire.
      await new Promise(resolve => setImmediate(resolve));

      process.off('unhandledRejection', rejectionHandler);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Response shape drift');
      expect(rejectionHandler).not.toHaveBeenCalled();
      consoleErr.mockRestore();
    });

    it('warns (does not throw) on response drift when NODE_ENV is production', async () => {
      process.env.NODE_ENV = 'production';

      const Schema = z.object({ id: z.string(), label: z.string() });
      const app = express();
      app.get('/drift', validate({ name: 'GET /drift', response: Schema }), (_req, res) => {
        res.json({ id: 'a1', name: 'oops' });
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await request(app).get('/drift');

      // In prod we soft-log and still deliver the body — soft logging so a bad
      // deploy doesn't 500 every customer; hard failure in tests catches drift.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 'a1', name: 'oops' });
      expect(warn).toHaveBeenCalled();
      const message = warn.mock.calls[0]?.[0];
      expect(message).toContain('Response shape drift on GET /drift');
      expect(message).toContain('label');

      warn.mockRestore();
    });

    it('skips response validation for error envelopes (non-2xx)', async () => {
      // Error responses have shape { error: string } regardless of the success
      // schema; the middleware must not flag them.
      const Schema = z.object({ id: z.string() });
      const app = express();
      app.get('/missing', validate({ response: Schema }), (_req, res) => {
        res.status(404).json({ error: 'Not found' });
      });

      const res = await request(app).get('/missing');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    it('validates the post-JSON-serialization (wire) shape, not raw JS values', async () => {
      // Date instances JSON-serialize to ISO strings — the wire shape. The
      // middleware must validate the wire shape, not the in-memory object,
      // otherwise it produces false positives on Prisma rows (Date in JS,
      // string on the wire).
      const Schema = z.object({ created_at: z.string() });
      const app = express();
      app.get('/dated', validate({ response: Schema }), (_req, res) => {
        res.json({ created_at: new Date('2026-05-18T00:00:00.000Z') });
      });

      const res = await request(app).get('/dated');
      expect(res.status).toBe(200);
      expect(res.body.created_at).toBe('2026-05-18T00:00:00.000Z');
    });
  });
});
