import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  DEFAULT_MEDIA_TTL_MINUTES,
  __resetMediaConfigForTests,
  getMediaConfig,
  mediaWindow,
  signMediaPath,
  verifyMediaRequest,
  type MediaConfig,
} from '../mediaUrl';

const SECRET = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const cfg = (over: Partial<MediaConfig> = {}): MediaConfig => ({
  secret: Buffer.from(SECRET),
  previous: null,
  ttlMinutes: 60,
  mode: 'enforce',
  ...over,
});
const T = new Date('2026-11-16T10:30:00Z');
const parse = (signed: string) => {
  const u = new URL(signed, 'http://x');
  return { path: u.pathname.slice(u.pathname.indexOf('/', 1)), query: Object.fromEntries(u.searchParams) };
};
const verify = (signed: string, root: 'illustrations' | 'uploads', now = T, c = cfg()) => {
  const { path, query } = parse(signed);
  return verifyMediaRequest(root, path, query, now, c);
};

describe('mediaWindow', () => {
  it('is deterministic within a window and lives between W and 2W', () => {
    const a = mediaWindow(new Date('2026-11-16T10:00:00Z'), 60);
    const b = mediaWindow(new Date('2026-11-16T10:59:59Z'), 60);
    expect(a).toEqual(b);
    expect(a.expiresAt).toBe(a.windowStart.getTime() / 1000 + 7200);
    expect(mediaWindow(new Date('2026-11-16T11:00:00Z'), 60).expiresAt).toBe(a.expiresAt + 3600);
  });
});

describe('sign + verify', () => {
  it('round-trips under both roots', () => {
    for (const root of ['illustrations', 'uploads'] as const) {
      const signed = signMediaPath(`/${root}/book 1/page-1.png`, T, cfg());
      expect(signed).toMatch(new RegExp(`^/${root}/book%201/page-1\\.png\\?e=\\d+&s=[A-Za-z0-9_-]{43}$`));
      expect(verify(signed, root)).toMatchObject({ ok: true, key: 'book 1/page-1.png' });
    }
  });

  it('is byte-identical within a window (1000 signs) and differs across one', () => {
    const outs = new Set<string>();
    for (let i = 0; i < 1000; i++) outs.add(signMediaPath('/illustrations/a/b.png', new Date(T.getTime() + i * 1000), cfg()));
    expect(outs.size).toBe(1);
    expect(signMediaPath('/illustrations/a/b.png', new Date(T.getTime() + 3600_000), cfg())).not.toBe([...outs][0]);
  });

  it('is idempotent and canonicalises an already-signed input', () => {
    const once = signMediaPath('/illustrations/a/b.png', T, cfg());
    expect(signMediaPath(once, T, cfg())).toBe(once);
  });

  it('returns non-media paths and invalid keys unchanged', () => {
    for (const p of ['/api/books', 'https://x.test/a.png', '/illustrations/../x', '/illustrations/%2e%2e/x', '/illustrations/uploads/x.png', '/illustrations/%E0%A4%A']) {
      expect(signMediaPath(p, T, cfg())).toBe(p);
    }
  });

  it('boundaries: valid until e, expired at e, too-far past 2W + 60s', () => {
    const signed = signMediaPath('/illustrations/a.png', T, cfg());
    const e = Number(parse(signed).query.e);
    expect(verify(signed, 'illustrations', new Date(e * 1000 - 1000))).toMatchObject({ ok: true });
    expect(verify(signed, 'illustrations', new Date(e * 1000))).toMatchObject({ ok: false, reason: 'expired' });
    const { path, query } = parse(signed);
    const farNow = new Date((e - 2 * 3600 - 60 - 1) * 1000);
    expect(verifyMediaRequest('illustrations', path, query, farNow, cfg())).toMatchObject({ ok: false, reason: 'too-far' });
    expect(verifyMediaRequest('illustrations', path, query, new Date((e - 2 * 3600 - 60) * 1000), cfg())).toMatchObject({ ok: true });
  });

  it('fails when s, e, key or root is tampered', () => {
    const signed = signMediaPath('/illustrations/a/b.png', T, cfg());
    const { path, query } = parse(signed);
    const v = (r: 'illustrations' | 'uploads', p: string, q: Record<string, unknown>) => verifyMediaRequest(r, p, q, T, cfg());
    const flipped = (query.s[0] === 'A' ? 'B' : 'A') + query.s.slice(1);
    expect(v('illustrations', path, { ...query, s: flipped })).toMatchObject({ ok: false, reason: 'bad-signature' });
    expect(v('illustrations', path, { ...query, e: String(Number(query.e) - 60) })).toMatchObject({ ok: false, reason: 'bad-signature' });
    expect(v('illustrations', '/a/c.png', query)).toMatchObject({ ok: false, reason: 'bad-signature' });
    expect(v('uploads', path, query)).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('rejects traversal, leading slash, trailing slash, malformed escapes, reserved prefix', () => {
    const q = parse(signMediaPath('/illustrations/a.png', T, cfg())).query;
    for (const p of ['/../a.png', '//a.png', '/a/', '/%2e%2e/a.png', '/%2E%2E/a.png', '/%E0%A4%A', '/a%5Cb', '/a%00b', '/uploads/x.png']) {
      const r = verifyMediaRequest('illustrations', p, q, T, cfg());
      expect(r.ok, p).toBe(false);
    }
    // uploads/ is only a reserved first segment under the illustrations root
    const up = signMediaPath('/uploads/x.png', T, cfg());
    expect(verify(up, 'uploads')).toMatchObject({ ok: true });
  });

  it('reports missing and malformed params; wrong-length s fails before compare', () => {
    const q = parse(signMediaPath('/illustrations/a.png', T, cfg())).query;
    const v = (qq: Record<string, unknown>) => verifyMediaRequest('illustrations', '/a.png', qq, T, cfg());
    expect(v({})).toMatchObject({ ok: false, reason: 'missing' });
    expect(v({ e: q.e })).toMatchObject({ ok: false, reason: 'missing' });
    expect(v({ e: ['1', '2'], s: q.s })).toMatchObject({ ok: false, reason: 'malformed' });
    expect(v({ e: '12abc', s: q.s })).toMatchObject({ ok: false, reason: 'malformed' });
    expect(v({ e: q.e, s: '!!!' })).toMatchObject({ ok: false, reason: 'malformed' });
    expect(v({ e: q.e, s: 'abcd' })).toMatchObject({ ok: false, reason: 'bad-signature' });
    expect(v({ e: q.e, s: q.s + 'A' })).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('ignores unknown query params', () => {
    const { path, query } = parse(signMediaPath('/illustrations/a.png', T, cfg()));
    expect(verifyMediaRequest('illustrations', path, { ...query, v: '9' }, T, cfg())).toMatchObject({ ok: true });
  });

  it('PREVIOUS verifies but is never used to sign', () => {
    const old = cfg({ secret: Buffer.from(OTHER) });
    const signedOld = signMediaPath('/illustrations/a.png', T, old);
    const rotated = cfg({ previous: Buffer.from(OTHER) });
    expect(verify(signedOld, 'illustrations', T, rotated)).toMatchObject({ ok: true });
    expect(verify(signedOld, 'illustrations', T, cfg())).toMatchObject({ ok: false, reason: 'bad-signature' });
    expect(signMediaPath('/illustrations/a.png', T, rotated)).toBe(signMediaPath('/illustrations/a.png', T, cfg()));
  });

  it('a lowered TTL kills links minted under a longer one', () => {
    const signed = signMediaPath('/illustrations/a.png', T, cfg({ ttlMinutes: 1440 }));
    expect(verify(signed, 'illustrations', T, cfg({ ttlMinutes: 60 }))).toMatchObject({ ok: false, reason: 'too-far' });
  });
});

describe('getMediaConfig', () => {
  let warn: MockInstance<(...args: unknown[]) => void>;
  beforeEach(() => {
    __resetMediaConfigForTests();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    __resetMediaConfigForTests();
  });
  const warnings = () => warn.mock.calls.map((c: unknown[]) => String(c[0]));

  it('uses the configured secret and previous', () => {
    const c = getMediaConfig({ MEDIA_URL_SECRET: SECRET, MEDIA_URL_SECRET_PREVIOUS: OTHER, NODE_ENV: 'production' });
    expect(c.secret.toString()).toBe(SECRET);
    expect(c.previous?.toString()).toBe(OTHER);
    expect(warn).not.toHaveBeenCalled();
  });

  it('production with an unset or short secret: random per-process, one warning, no value logged', () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', MEDIA_URL_SECRET: 'short-secret-value' }]) {
      warn.mockClear();
      const a = getMediaConfig(env);
      const b = getMediaConfig(env);
      expect(a.secret).toHaveLength(32);
      expect(a.secret.equals(b.secret)).toBe(false);
      expect(warnings().filter(w => w.includes('MEDIA_URL_SECRET'))).toHaveLength(2);
      expect(warnings().join()).not.toContain('short-secret-value');
    }
  });

  it('the dev constant is used outside production and never in production', () => {
    const dev1 = getMediaConfig({});
    const dev2 = getMediaConfig({ NODE_ENV: 'test' });
    expect(dev1.secret.equals(dev2.secret)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    const prod = getMediaConfig({ NODE_ENV: 'production' });
    expect(prod.secret.equals(dev1.secret)).toBe(false);
  });

  it('a short PREVIOUS is ignored with a warning', () => {
    expect(getMediaConfig({ MEDIA_URL_SECRET_PREVIOUS: 'tiny' }).previous).toBeNull();
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('MEDIA_URL_SECRET_PREVIOUS');
    expect(warnings()[0]).not.toContain('tiny');
  });

  it('mode: case and whitespace tolerated; blank is enforce; garbage is enforce plus one warning', () => {
    expect(getMediaConfig({ MEDIA_URL_MODE: 'Enforce ' }).mode).toBe('enforce');
    expect(getMediaConfig({ MEDIA_URL_MODE: ' LENIENT' }).mode).toBe('lenient');
    expect(getMediaConfig({ MEDIA_URL_MODE: '  ' }).mode).toBe('enforce');
    expect(getMediaConfig({}).mode).toBe('enforce');
    expect(warn).not.toHaveBeenCalled();
    expect(getMediaConfig({ MEDIA_URL_MODE: 'off' }).mode).toBe('enforce');
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('MEDIA_URL_MODE');
    expect(warnings()[0]).not.toContain('off');
  });

  it('ttl: 5..1440 accepted; out of range or malformed gives 60 with a warning', () => {
    expect(getMediaConfig({ MEDIA_URL_TTL_MINUTES: '5' }).ttlMinutes).toBe(5);
    expect(getMediaConfig({ MEDIA_URL_TTL_MINUTES: '1440' }).ttlMinutes).toBe(1440);
    expect(getMediaConfig({}).ttlMinutes).toBe(DEFAULT_MEDIA_TTL_MINUTES);
    expect(warn).not.toHaveBeenCalled();
    for (const bad of ['4', '1441', '60m', 'abc']) {
      warn.mockClear();
      expect(getMediaConfig({ MEDIA_URL_TTL_MINUTES: bad }).ttlMinutes).toBe(60);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toContain('MEDIA_URL_TTL_MINUTES');
    }
  });

  it('memoizes the process-env config until reset', () => {
    const a = getMediaConfig();
    expect(getMediaConfig()).toBe(a);
    __resetMediaConfigForTests();
    expect(getMediaConfig()).not.toBe(a);
  });
});
