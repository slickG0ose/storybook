import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  hashToken,
  resolveTokenTtlDays,
  issueToken,
  resetTokenTtlWarning,
} from '../authToken';

describe('hashToken', () => {
  it('is deterministic, 64 lowercase hex, and differs from input', () => {
    const h = hashToken('abc');
    expect(hashToken('abc')).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe('abc');
    expect(hashToken('abd')).not.toBe(h);
  });
});

describe('resolveTokenTtlDays', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetTokenTtlWarning();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('defaults to 30 when unset, silently', () => {
    expect(resolveTokenTtlDays({})).toBe(30);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['', '  '])('treats blank %j as default without warning', (v) => {
    expect(resolveTokenTtlDays({ TOKEN_TTL_DAYS: v })).toBe(30);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([['7', 7], ['1', 1], ['90', 90]])('accepts %s', (v, n) => {
    expect(resolveTokenTtlDays({ TOKEN_TTL_DAYS: v })).toBe(n);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1.5', 'abc', '91', '3000', '30d'])('falls back to 30 for %s', (v) => {
    expect(resolveTokenTtlDays({ TOKEN_TTL_DAYS: v })).toBe(30);
  });

  it('warns once across repeated bad values, without echoing the value', () => {
    resolveTokenTtlDays({ TOKEN_TTL_DAYS: 'zzz-bad' });
    resolveTokenTtlDays({ TOKEN_TTL_DAYS: '3000' });
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain('TOKEN_TTL_DAYS');
    expect(msg).not.toContain('zzz-bad');
  });
});

describe('issueToken', () => {
  it('returns a UUIDv4, its hash, and an expiry exactly TTL days out', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const out = issueToken(now, { TOKEN_TTL_DAYS: '2' });
    expect(out.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(out.tokenHash).toBe(hashToken(out.token));
    expect(out.expiresAt.getTime() - now.getTime()).toBe(2 * 24 * 60 * 60 * 1000);
  });
});
