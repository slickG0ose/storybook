import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Express } from 'express';
import { NARRATION_VOICES } from '@storybook/shared';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { costCentsFor } from '../../services/spend';
import { ILLUSTRATIONS_DIR } from '../../services/storage';

// No live fal call. The synthesizer seam is replaced by a call-counting fake that
// returns the committed 100 ms silent WAV; green here proves routing, auth order,
// visibility, and metering — not that Kokoro speaks correctly.

const fake = vi.hoisted(() => ({
  calls: 0,
  fail: false,
  wav: null as Buffer | null,
}));

vi.mock('../../services/narration/synthesizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/narration/synthesizer')>();
  return {
    ...actual,
    getNarrationSynthesizer: () => ({
      async synthesize(): Promise<Buffer> {
        fake.calls++;
        if (fake.fail) throw new actual.NarrationSynthesisError('fake upstream failure');
        return fake.wav!;
      },
    }),
  };
});

const BOOK_ID = 'narration-route-test';
const BOOK_DIR = join(ILLUSTRATIONS_DIR, BOOK_ID);
// Two sentences → two segments.
const PAGE_1 = 'Luna looked up. The stars were singing!';

async function register(app: Express, email: string): Promise<{ token: string; id: string }> {
  await allowEmail(email);
  const res = await request(app).post('/api/auth/register').send({ email, name: 'Reader', password: 'pass1234' });
  expect(res.status).toBe(201);
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  return { token: res.body.token as string, id: user.id };
}

async function createBook(ownerId: string, status: 'draft' | 'published'): Promise<void> {
  await prisma.book.create({
    data: {
      id: BOOK_ID,
      title: 'Luna and the Star Garden',
      author: 'AI Storybook',
      description: 'test',
      theme: 'fantasy',
      age_range: '4-7',
      cover_emoji: '*',
      cover_color: '#000000',
      price: 1,
      status,
      created_by: ownerId,
      is_user_created: true,
      pages: {
        create: [
          { page_number: 1, text: PAGE_1, illustration_description: 'x' },
          { page_number: 2, text: '   ', illustration_description: 'x' },
        ],
      },
    },
  });
}

const narrationPath = `/api/books/${BOOK_ID}/narration`;

async function narrationUsage() {
  return prisma.usageLog.findMany({ where: { kind: 'narration' } });
}

describe('Narration routes', () => {
  let app: Express;
  let owner: { token: string; id: string };

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    await rm(BOOK_DIR, { recursive: true, force: true });
    fake.calls = 0;
    fake.fail = false;
    fake.wav = readFileSync(
      join(import.meta.dirname, '../../services/narration/__tests__/fixtures/silence-100ms.wav'),
    );
    vi.stubEnv('FAL_KEY', 'test-fal-key');
    vi.stubEnv('STORAGE_BACKEND', 'local');
    owner = await register(app, 'owner@example.com');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(BOOK_DIR, { recursive: true, force: true });
  });

  afterAll(async () => {
    await resetDatabase();
  });

  // -------------------------------------------------------------------------
  describe('GET /api/narration/voices', () => {
    it('returns availability and the voice catalog (wire shape)', async () => {
      const res = await request(app).get('/api/narration/voices');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        available: expect.any(Boolean),
        voices: [
          {
            id: expect.any(String),
            label: expect.any(String),
            description: expect.any(String),
            gender: expect.any(String),
          },
          {
            id: expect.any(String),
            label: expect.any(String),
            description: expect.any(String),
            gender: expect.any(String),
          },
        ],
      });
      expect(res.body.available).toBe(true);
      expect(res.body.voices.map((v: { id: string }) => v.id)).toEqual(NARRATION_VOICES.map((v) => v.id));
    });

    it('reports available: false with FAL_KEY unset', async () => {
      vi.stubEnv('FAL_KEY', '');
      const res = await request(app).get('/api/narration/voices');
      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/books/:id/narration', () => {
    it('ready: returns the cached clip (wire shape) without touching the synthesizer', async () => {
      await createBook(owner.id, 'published');
      const post = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ voiceId: 'af_heart', slot: 1 });
      expect(post.status).toBe(200);
      fake.calls = 0;

      // Signed out: published books' cached audio is free to everyone.
      const res = await request(app).get(narrationPath).query({ voice: 'af_heart', slot: '1' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ready',
        voiceId: 'af_heart',
        slot: 1,
        textHash: expect.any(String),
        cached: true,
        segments: [
          {
            index: 0,
            start: expect.any(Number),
            end: expect.any(Number),
            url: expect.stringMatching(new RegExp(`^/illustrations/${BOOK_ID}/narration/.+\\.wav$`)),
            durationMs: expect.any(Number),
          },
          {
            index: 1,
            start: expect.any(Number),
            end: expect.any(Number),
            url: expect.any(String),
            durationMs: expect.any(Number),
          },
        ],
      });
      expect(fake.calls).toBe(0);
    });

    it('missing: returns { status: "missing" } and never calls the synthesizer', async () => {
      await createBook(owner.id, 'published');
      const res = await request(app).get(narrationPath).query({ voice: 'am_michael', slot: 'cover' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'missing' });
      expect(res.body).toEqual({ status: 'missing' });
      expect(fake.calls).toBe(0);
      expect(await narrationUsage()).toHaveLength(0);
    });

    it('a slot the book does not have reads as missing, not an error', async () => {
      await createBook(owner.id, 'published');
      const res = await request(app).get(narrationPath).query({ voice: 'af_heart', slot: '99' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'missing' });
    });

    it.each([
      [{ voice: 'af_heart' }],
      [{ slot: '1' }],
      [{ voice: 'bf_emma', slot: '1' }],
      [{ voice: 'af_heart', slot: 'middle' }],
      [{ voice: 'af_heart', slot: '0' }],
      [{ voice: 'af_heart', slot: '1.5' }],
    ])('400 on a bad query %o', async (query) => {
      await createBook(owner.id, 'published');
      const res = await request(app).get(narrationPath).query(query);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it("404 on a draft for anyone but its owner; the owner can read it", async () => {
      await createBook(owner.id, 'draft');
      const stranger = await register(app, 'stranger@example.com');

      const anon = await request(app).get(narrationPath).query({ voice: 'af_heart', slot: '1' });
      expect(anon.status).toBe(404);
      expect(anon.body).toMatchObject({ error: expect.any(String) });

      const other = await request(app)
        .get(narrationPath)
        .set('Authorization', `Bearer ${stranger.token}`)
        .query({ voice: 'af_heart', slot: '1' });
      expect(other.status).toBe(404);

      const own = await request(app)
        .get(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .query({ voice: 'af_heart', slot: '1' });
      expect(own.status).toBe(200);
      expect(own.body).toEqual({ status: 'missing' });
    });

    it('404 on a missing or soft-deleted book', async () => {
      const res = await request(app).get('/api/books/no-such-book/narration').query({ voice: 'af_heart', slot: '1' });
      expect(res.status).toBe(404);

      await createBook(owner.id, 'published');
      await prisma.book.update({ where: { id: BOOK_ID }, data: { deleted_at: new Date() } });
      const deleted = await request(app).get(narrationPath).query({ voice: 'af_heart', slot: '1' });
      expect(deleted.status).toBe(404);
    });

    it('does not shadow GET /api/books/:id', async () => {
      await createBook(owner.id, 'published');
      const res = await request(app).get(`/api/books/${BOOK_ID}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: BOOK_ID });
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/books/:id/narration', () => {
    it('401 with no token, before the body is validated', async () => {
      await createBook(owner.id, 'published');
      const res = await request(app).post(narrationPath).send({ voiceId: 'af_heart', slot: 1, text: 'pwned' });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(fake.calls).toBe(0);
    });

    it('400 on an extra `text` field — the server derives what to speak', async () => {
      await createBook(owner.id, 'published');
      const res = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ voiceId: 'af_heart', slot: 1, text: 'Say something else entirely.' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(fake.calls).toBe(0);
    });

    it("404 on a stranger's draft", async () => {
      await createBook(owner.id, 'draft');
      const stranger = await register(app, 'stranger@example.com');
      const res = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${stranger.token}`)
        .send({ voiceId: 'af_heart', slot: 1 });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(fake.calls).toBe(0);
      expect(await narrationUsage()).toHaveLength(0);
    });

    it('404 for a slot the book does not have, and for a whitespace-only page', async () => {
      await createBook(owner.id, 'published');
      for (const slot of [99, 2]) {
        const res = await request(app)
          .post(narrationPath)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ voiceId: 'af_heart', slot });
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ error: expect.any(String) });
      }
      expect(fake.calls).toBe(0);
      expect(await narrationUsage()).toHaveLength(0);
    });

    it('501 with FAL_KEY unset', async () => {
      vi.stubEnv('FAL_KEY', '');
      await createBook(owner.id, 'published');
      const res = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ voiceId: 'af_heart', slot: 1 });
      expect(res.status).toBe(501);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(fake.calls).toBe(0);
    });

    it('501 in production when storage is local disk (paid bytes would not survive)', async () => {
      await createBook(owner.id, 'published');
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('STORAGE_BACKEND', 'local');
      const res = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ voiceId: 'af_heart', slot: 1 });
      expect(res.status).toBe(501);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(fake.calls).toBe(0);
    });

    it('429 quota envelope with Retry-After at the daily cap, nothing synthesised', async () => {
      await createBook(owner.id, 'published');
      vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '5');
      await prisma.usageLog.create({ data: { user_id: owner.id, kind: 'story', cost_cents: 5 } });

      const res = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ voiceId: 'af_heart', slot: 1 });
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toMatch(/^\d+$/);
      expect(res.body).toMatchObject({
        error: expect.any(String),
        quota: { scope: 'daily', spentCents: expect.any(Number), limitCents: expect.any(Number) },
      });
      expect(fake.calls).toBe(0);
      expect(await narrationUsage()).toHaveLength(0);
    });

    it('502 on synth failure, with no UsageLog and no row', async () => {
      await createBook(owner.id, 'published');
      fake.fail = true;
      const res = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ voiceId: 'af_heart', slot: 1 });
      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(await narrationUsage()).toHaveLength(0);
      expect(await prisma.narrationClip.count({ where: { book_id: BOOK_ID } })).toBe(0);
    });

    it('200 miss (wire shape, charged once) then 200 cached: true (no synth, no charge)', async () => {
      await createBook(owner.id, 'published');
      const first = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ voiceId: 'am_michael', slot: 1 });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        status: 'ready',
        voiceId: 'am_michael',
        slot: 1,
        textHash: expect.any(String),
        cached: false,
        segments: [
          {
            index: 0,
            start: expect.any(Number),
            end: expect.any(Number),
            url: expect.stringMatching(/^\/illustrations\//),
            durationMs: expect.any(Number),
          },
          {
            index: 1,
            start: expect.any(Number),
            end: expect.any(Number),
            url: expect.any(String),
            durationMs: expect.any(Number),
          },
        ],
      });
      expect(fake.calls).toBe(2);
      const usage = await narrationUsage();
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({
        user_id: owner.id,
        cost_cents: costCentsFor('narration', undefined, PAGE_1.length),
      });

      const second = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ voiceId: 'am_michael', slot: 1 });
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ status: 'ready', cached: true });
      expect(second.body.segments).toEqual(first.body.segments);
      expect(fake.calls).toBe(2);
      expect(await narrationUsage()).toHaveLength(1);
    });

    it('cover and end slots are generatable', async () => {
      await createBook(owner.id, 'published');
      for (const slot of ['cover', 'end'] as const) {
        const res = await request(app)
          .post(narrationPath)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ voiceId: 'af_heart', slot });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'ready', slot, cached: false });
      }
    });

    it('a signed-in non-owner of a published book may generate, and is the one charged', async () => {
      await createBook(owner.id, 'published');
      const reader = await register(app, 'reader@example.com');
      const res = await request(app)
        .post(narrationPath)
        .set('Authorization', `Bearer ${reader.token}`)
        .send({ voiceId: 'af_heart', slot: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ready', cached: false });

      const usage = await narrationUsage();
      expect(usage).toHaveLength(1);
      expect(usage[0]!.user_id).toBe(reader.id);
      const row = await prisma.narrationClip.findFirstOrThrow({ where: { book_id: BOOK_ID } });
      expect(row.created_by).toBe(reader.id);
    });
  });
});
