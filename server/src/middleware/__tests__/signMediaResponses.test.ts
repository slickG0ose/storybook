import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mediaPath } from '@storybook/shared';
import { signMediaResponses } from '../media';

// Unit cases for the outbound choke point (#237, decision 2). No database, no routes.

const SIGNED = /^\/illustrations\/[^?]+\?e=\d+&s=[A-Za-z0-9_-]{43}$/;

function appReturning(body: unknown) {
  const app = express();
  app.use('/api', signMediaResponses);
  app.get('/api/x', (_req, res) => {
    res.json(body);
  });
  return app;
}

describe('signMediaResponses', () => {
  it('signs every allowlisted key, in objects and arrays', async () => {
    const res = await request(
      appReturning({
        cover_url: '/illustrations/b/cover.png',
        pages: [{ illustration_url: '/illustrations/b/page-1.png' }],
        characters: [{ portrait_url: '/illustrations/b/portrait-1000.png' }],
        style_reference_url: '/uploads/style-refs/a.png',
        segments: [{ url: '/illustrations/b/narration/p1-af_heart-abc-0.wav' }],
      }),
    ).get('/api/x');
    expect(res.body).toMatchObject({
      cover_url: expect.stringMatching(SIGNED),
      pages: [{ illustration_url: expect.stringMatching(SIGNED) }],
      characters: [{ portrait_url: expect.stringMatching(SIGNED) }],
      style_reference_url: expect.stringMatching(/^\/uploads\/style-refs\/a\.png\?e=\d+&s=[A-Za-z0-9_-]{43}$/),
      segments: [{ url: expect.stringMatching(SIGNED) }],
    });
  });

  it('leaves `path`, non-media values, /hero frames and null untouched', async () => {
    const body = {
      path: '/illustrations/orphan-book',
      cover_url: null,
      url: '/hero/frame-1.webp',
      title: '/illustrations/not-a-url-field.png',
      illustration_url: 'https://example.com/x.png',
    };
    const res = await request(appReturning(body)).get('/api/x');
    expect(res.body).toEqual(body);
  });

  it('is idempotent: an already-signed value is canonicalised and re-signed, not stacked', async () => {
    const res = await request(appReturning({ cover_url: '/illustrations/b/cover.png?e=1&s=junk' })).get('/api/x');
    expect(res.body.cover_url).toMatch(SIGNED);
    expect(mediaPath(res.body.cover_url)).toBe('/illustrations/b/cover.png');
    expect(res.body.cover_url.match(/\?/g)).toHaveLength(1);
  });

  it('gives every URL in one response the same window', async () => {
    const res = await request(
      appReturning({ a: { cover_url: '/illustrations/b/1.png' }, b: { cover_url: '/illustrations/b/2.png' } }),
    ).get('/api/x');
    const e = (u: string) => new URL(u, 'http://x').searchParams.get('e');
    expect(e(res.body.a.cover_url)).toBe(e(res.body.b.cover_url));
  });

  it('does not mutate the object the handler passed in', async () => {
    const body = { cover_url: '/illustrations/b/cover.png' };
    let seen: typeof body | null = null;
    const app = express();
    app.use('/api', signMediaResponses);
    app.get('/api/x', (_req, res) => {
      res.json(body);
      seen = body;
    });
    await request(app).get('/api/x');
    expect(seen).toEqual({ cover_url: '/illustrations/b/cover.png' });
  });

  it('leaves Date and other class instances alone (they serialise as before)', async () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    const res = await request(appReturning({ created_at: d, cover_url: '/illustrations/b/c.png' })).get('/api/x');
    expect(res.body.created_at).toBe('2026-01-02T03:04:05.000Z');
    expect(res.body.cover_url).toMatch(SIGNED);
  });

  it('stops at the depth cap: nesting past 8 levels is left unsigned', async () => {
    let deep: Record<string, unknown> = { cover_url: '/illustrations/b/deep.png' };
    for (let i = 0; i < 10; i += 1) deep = { n: deep };
    let shallow: Record<string, unknown> = { cover_url: '/illustrations/b/ok.png' };
    for (let i = 0; i < 3; i += 1) shallow = { n: shallow };
    const res = await request(appReturning({ deep, shallow })).get('/api/x');
    let d: Record<string, unknown> = res.body.deep;
    for (let i = 0; i < 10; i += 1) d = d.n as Record<string, unknown>;
    expect(d.cover_url).toBe('/illustrations/b/deep.png');
    let s: Record<string, unknown> = res.body.shallow;
    for (let i = 0; i < 3; i += 1) s = s.n as Record<string, unknown>;
    expect(s.cover_url).toMatch(SIGNED);
  });

  it('passes a non-object body (array of strings, null) through', async () => {
    expect((await request(appReturning(['/illustrations/b/c.png'])).get('/api/x')).body).toEqual(['/illustrations/b/c.png']);
    expect((await request(appReturning(null)).get('/api/x')).body).toBeNull();
  });
});
