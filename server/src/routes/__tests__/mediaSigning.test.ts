import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createHash } from 'crypto';
import type { Express } from 'express';
import { NARRATION_MODEL, mediaPath, narrationTextFor } from '@storybook/shared';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';

// Outbound media signing, end to end through the real routers (#237 Task 5).
// Rows are inserted directly: no fal, no Anthropic, no R2 is reachable from here.

const BOOK = 'luna-star-garden';
const SIGNED_RE = /^\/(illustrations|uploads)\/[^?]+\?e=\d+&s=[A-Za-z0-9_-]{43}$/;
const ILLUSTRATION_RE = /^\/illustrations\/[^?]+\?e=\d+&s=[A-Za-z0-9_-]{43}$/;
const MEDIA_LIKE = /^\/(illustrations|uploads)\//;

async function user(app: Express, email: string, role: 'user' | 'admin' = 'user') {
  await allowEmail(email);
  const reg = await request(app).post('/api/auth/register').send({ email, name: 'N', password: 'pass1234' });
  if (role === 'admin') await prisma.user.update({ where: { id: reg.body.id }, data: { role: 'admin' } });
  return { token: reg.body.token as string, id: reg.body.id as string };
}

/** Every media-looking string in a JSON body must be signed, except under the key `path`. */
function unsignedMedia(value: unknown, key = '', found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (key !== 'path' && MEDIA_LIKE.test(value) && !(/[?&]e=\d+/.test(value) && /[?&]s=/.test(value))) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach(v => unsignedMedia(v, key, found));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) unsignedMedia(v, k, found);
  }
  return found;
}

describe('outbound media signing', () => {
  let app: Express;
  let owner: { token: string; id: string };
  let admin: { token: string; id: string };

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    owner = await user(app, 'owner@example.com');
    admin = await user(app, 'admin@example.com', 'admin');

    await prisma.book.update({
      where: { id: BOOK },
      data: {
        status: 'draft',
        created_by: owner.id,
        cover_url: `/illustrations/${BOOK}/cover.png`,
        style_reference_url: '/uploads/style-refs/123e4567-e89b-12d3-a456-426614174000.jpg',
        characters_json: JSON.stringify([
          { role: 'primary', name: 'Luna', description: 'A girl', portrait_url: `/illustrations/${BOOK}/portrait-1000.png` },
        ]),
      },
    });
    await prisma.page.updateMany({
      where: { book_id: BOOK },
      data: { illustration_url: null },
    });
    for (let n = 1; n <= 5; n += 1) {
      await prisma.page.update({
        where: { book_id_page_number: { book_id: BOOK, page_number: n } },
        data: { illustration_url: `/illustrations/${BOOK}/page-${n}.png` },
      });
    }
    await prisma.illustrationVersion.createMany({
      data: [
        { book_id: BOOK, page_number: 1, version: 1, url: `/illustrations/${BOOK}/page-1.png` },
        { book_id: BOOK, page_number: 1000, version: 1, url: `/illustrations/${BOOK}/portrait-1000.png` },
      ],
    });
    await prisma.bookVersion.create({
      data: {
        book_id: BOOK,
        version: 1,
        pages_json: JSON.stringify([{ page_number: 1, text: 'Page 1 text', illustrationDescription: 'Illustration 1' }]),
      },
    });
    // Clip for page 1 under af_heart, keyed by the real text hash so GET finds it.
    const page1 = await prisma.page.findUnique({ where: { book_id_page_number: { book_id: BOOK, page_number: 1 } } });
    const text = narrationTextFor(
      { title: 'Luna and the Star Garden', author: 'AI Storybook', pages: [{ page_number: 1, text: page1!.text }] },
      1,
    ) as string;
    await prisma.narrationClip.create({
      data: {
        book_id: BOOK,
        slot: 'p1',
        voice_id: 'af_heart',
        model: NARRATION_MODEL,
        text_hash: createHash('sha256').update(text, 'utf8').digest('hex'),
        chars: text.length,
        segments_json: JSON.stringify([{ index: 0, start: 0, end: 1000, key: `${BOOK}/narration/p1-af_heart-x-0.wav`, durationMs: 1000 }]),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('wire shape: book detail, mine, list, version lists, narration and admin list are signed', async () => {
    const detail = await request(app).get(`/api/books/${BOOK}`).set(auth(owner.token));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      cover_url: expect.stringMatching(ILLUSTRATION_RE),
      style_reference_url: expect.stringMatching(SIGNED_RE),
      pages: expect.arrayContaining([expect.objectContaining({ illustration_url: expect.stringMatching(ILLUSTRATION_RE) })]),
      characters: [expect.objectContaining({ portrait_url: expect.stringMatching(ILLUSTRATION_RE) })],
    });
    expect(detail.body.pages[0].illustration_url).toMatch(ILLUSTRATION_RE);

    const mine = await request(app).get('/api/books/mine').set(auth(owner.token));
    expect(mine.status).toBe(200);
    expect(mine.body[0]).toMatchObject({ cover_url: expect.stringMatching(ILLUSTRATION_RE) });

    await prisma.book.update({ where: { id: BOOK }, data: { status: 'published' } });
    const list = await request(app).get('/api/books');
    const luna = (list.body as Array<{ id: string }>).find(b => b.id === BOOK);
    expect(luna).toMatchObject({ cover_url: expect.stringMatching(ILLUSTRATION_RE), style_reference_url: null });
    await prisma.book.update({ where: { id: BOOK }, data: { status: 'draft' } });

    const versions = await request(app).get(`/api/books/${BOOK}/illustrations/1`).set(auth(owner.token));
    expect(versions.status).toBe(200);
    expect(versions.body[0]).toMatchObject({ url: expect.stringMatching(ILLUSTRATION_RE), version: 1 });

    const portraits = await request(app).get(`/api/books/${BOOK}/characters/0/portraits`).set(auth(owner.token));
    expect(portraits.status).toBe(200);
    expect(portraits.body[0]).toMatchObject({ url: expect.stringMatching(ILLUSTRATION_RE), version: 1 });

    const narration = await request(app).get(`/api/books/${BOOK}/narration`).query({ voice: 'af_heart', slot: '1' }).set(auth(owner.token));
    expect(narration.status).toBe(200);
    expect(narration.body).toMatchObject({
      status: 'ready',
      segments: [{ url: expect.stringMatching(/^\/illustrations\/[^?]+\.wav\?e=\d+&s=[A-Za-z0-9_-]{43}$/) }],
    });

    const adminBooks = await request(app).get('/api/admin/books').set(auth(admin.token));
    expect(adminBooks.status).toBe(200);
    const row = (adminBooks.body as Array<{ id: string }>).find(b => b.id === BOOK);
    expect(row).toMatchObject({
      cover_url: expect.stringMatching(ILLUSTRATION_RE),
      style_reference_url: expect.stringMatching(SIGNED_RE),
    });
  });

  it('sweep: no route in the table returns an unsigned media URL, as owner or admin', async () => {
    const calls: Array<{ who: 'owner' | 'admin'; label: string; run: (t: string) => Promise<request.Response> }> = [];
    const add = (label: string, run: (t: string) => Promise<request.Response>) => {
      calls.push({ who: 'owner', label, run });
      calls.push({ who: 'admin', label, run });
    };
    const get = (url: string, q?: Record<string, string>) => (t: string) => request(app).get(url).query(q ?? {}).set(auth(t));
    const put = (url: string, body: object = {}) => (t: string) => request(app).put(url).send(body).set(auth(t));

    add('GET /books', get('/api/books'));
    add('GET /books/mine', get('/api/books/mine'));
    add('GET /books/:id', get(`/api/books/${BOOK}`));
    add('GET /books/:id/versions', get(`/api/books/${BOOK}/versions`));
    add('GET illustrations/:n', get(`/api/books/${BOOK}/illustrations/1`));
    add('GET portraits', get(`/api/books/${BOOK}/characters/0/portraits`));
    add('GET narration', get(`/api/books/${BOOK}/narration`, { voice: 'af_heart', slot: '1' }));
    add('PUT pages/:n', put(`/api/books/${BOOK}/pages/1`, { illustration_description: 'Illustration 1' }));
    add('PUT typography', put(`/api/books/${BOOK}/typography`, { font_family: 'lexend', text_size: 'large' }));
    add('PUT illustrations/:n/revert', put(`/api/books/${BOOK}/illustrations/1/revert`, { url: `/illustrations/${BOOK}/page-1.png` }));
    add('PUT versions/:v/restore', put(`/api/books/${BOOK}/versions/1/restore`));
    add('PUT publish', put(`/api/books/${BOOK}/publish`));
    add('PUT unpublish', put(`/api/books/${BOOK}/unpublish`));
    add('GET /admin/books', get('/api/admin/books'));
    add('PUT /admin/books/:id/featured', put(`/api/admin/books/${BOOK}/featured`, { is_featured: true }));
    add('PUT /admin/books/:id/hero-eligible', put(`/api/admin/books/${BOOK}/hero-eligible`, { is_hero_eligible: false }));
    add('PUT /admin/books/:id/restore', put(`/api/admin/books/${BOOK}/restore`));

    let withMedia = 0;
    for (const c of calls) {
      const res = await c.run(c.who === 'owner' ? owner.token : admin.token);
      expect(unsignedMedia(res.body), `${c.who} ${c.label} (HTTP ${res.status})`).toEqual([]);
      if (JSON.stringify(res.body ?? null).includes('e=')) withMedia += 1;
      // A draft is only ever left published/unpublished by the calls above; put it back.
      await prisma.book.update({ where: { id: BOOK }, data: { status: 'draft', created_by: owner.id, deleted_at: null } });
    }
    // The sweep is vacuous if nothing carried a URL.
    expect(withMedia).toBeGreaterThan(10);

    // The admin orphan list keeps `path` unsigned (Admin.tsx takes its last segment as an id).
    const orphans = await request(app).get('/api/admin/orphan-illustrations').set(auth(admin.token));
    expect(orphans.status).toBe(200);
    for (const o of orphans.body as Array<{ path?: string }>) expect(o.path).not.toMatch(/\?/);
  });

  it('the database stays unsigned after the sweep-style reads and writes', async () => {
    await request(app).get(`/api/books/${BOOK}`).set(auth(owner.token));
    await request(app)
      .put(`/api/books/${BOOK}/illustrations/1/revert`)
      .set(auth(owner.token))
      .send({ url: `/illustrations/${BOOK}/page-1.png` });
    const b = await prisma.book.findUnique({ where: { id: BOOK } });
    const pages = await prisma.page.findMany({ where: { book_id: BOOK } });
    expect(b!.cover_url).not.toContain('?');
    expect(b!.style_reference_url).not.toContain('?');
    expect(b!.characters_json).not.toContain('?e=');
    for (const p of pages) expect(p.illustration_url).not.toContain('?');
  });

  it('a signed URL sent back to revert is accepted and stored canonical', async () => {
    const list = await request(app).get(`/api/books/${BOOK}/illustrations/1`).set(auth(owner.token));
    const signed = list.body[0].url as string;
    expect(signed).toMatch(ILLUSTRATION_RE);
    const res = await request(app).put(`/api/books/${BOOK}/illustrations/1/revert`).set(auth(owner.token)).send({ url: signed });
    expect(res.status).toBe(200);
    const row = await prisma.page.findUnique({ where: { book_id_page_number: { book_id: BOOK, page_number: 1 } } });
    expect(row!.illustration_url).toBe(mediaPath(signed));
  });

  it('is stable within a window: two reads give deep-equal bodies', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T10:00:01Z'));
    const a = await request(app).get(`/api/books/${BOOK}`).set(auth(owner.token));
    vi.setSystemTime(new Date('2026-11-16T10:20:00Z'));
    const b = await request(app).get(`/api/books/${BOOK}`).set(auth(owner.token));
    expect(a.status).toBe(200);
    expect(b.body.cover_url).toMatch(ILLUSTRATION_RE);
    expect(b.body.pages.map((p: { illustration_url: string }) => p.illustration_url)).toEqual(
      a.body.pages.map((p: { illustration_url: string }) => p.illustration_url),
    );
    expect(b.body.cover_url).toBe(a.body.cover_url);
  });
});
