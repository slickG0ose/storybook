/**
 * Signed media URLs: config, sign, verify (#237, decisions 1 and 4).
 *
 * Pure: no Express, no Prisma, no fs. Imports only node:crypto, the shared
 * media helpers and `isValidKey`. Every fallback fails CLOSED: a malformed mode
 * means `enforce`, an unset production secret means a random per-process
 * secret, never unsigned. Warnings name the variable and never log a value.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MEDIA_EXPIRES_PARAM,
  MEDIA_PATH_RE,
  MEDIA_ROOTS,
  MEDIA_SIG_PARAM,
  mediaPath,
  type MediaRoot,
} from '@storybook/shared';
import { isValidKey } from '../services/storage';

export const DEFAULT_MEDIA_TTL_MINUTES = 60;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 1440;
const MIN_SECRET_CHARS = 32;
/** Slack on the "too far in the future" check, seconds. */
const FUTURE_SLACK_S = 60;

// Committed on purpose: non-production only, so `tsx watch` restarts do not
// break every image in dev. Never used when NODE_ENV=production.
const DEV_SECRET = Buffer.from('storybook-dev-media-secret-not-for-production-use', 'utf8');

export type MediaMode = 'enforce' | 'lenient';
export interface MediaConfig {
  secret: Buffer;
  previous: Buffer | null;
  ttlMinutes: number;
  mode: MediaMode;
}

function resolveSecret(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.MEDIA_URL_SECRET;
  if (raw !== undefined && raw.length >= MIN_SECRET_CHARS) return Buffer.from(raw, 'utf8');
  if (env.NODE_ENV === 'production') {
    console.warn(
      'MEDIA_URL_SECRET is unset or shorter than 32 characters; using a random per-process secret, so media links break on every restart',
    );
    return randomBytes(32);
  }
  return DEV_SECRET;
}

function resolvePrevious(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.MEDIA_URL_SECRET_PREVIOUS;
  if (raw === undefined || raw === '') return null;
  if (raw.length < MIN_SECRET_CHARS) {
    console.warn('MEDIA_URL_SECRET_PREVIOUS is shorter than 32 characters; ignoring it');
    return null;
  }
  return Buffer.from(raw, 'utf8');
}

function resolveTtl(env: NodeJS.ProcessEnv): number {
  const raw = env.MEDIA_URL_TTL_MINUTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MEDIA_TTL_MINUTES;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= MIN_TTL_MINUTES && n <= MAX_TTL_MINUTES) return n;
  }
  console.warn(
    `MEDIA_URL_TTL_MINUTES is not an integer from ${MIN_TTL_MINUTES} to ${MAX_TTL_MINUTES}; using ${DEFAULT_MEDIA_TTL_MINUTES}`,
  );
  return DEFAULT_MEDIA_TTL_MINUTES;
}

function resolveMode(env: NodeJS.ProcessEnv): MediaMode {
  const raw = env.MEDIA_URL_MODE;
  if (raw === undefined || raw.trim() === '') return 'enforce';
  const v = raw.trim().toLowerCase();
  if (v === 'enforce' || v === 'lenient') return v;
  console.warn('MEDIA_URL_MODE is not "enforce" or "lenient"; using enforce');
  return 'enforce';
}

let memo: MediaConfig | null = null;

/**
 * Memoized for the process env (the no-argument call). An explicit `env` is
 * resolved fresh each call and never memoized, so tests can probe fallbacks.
 */
export function getMediaConfig(env?: NodeJS.ProcessEnv): MediaConfig {
  if (env === undefined) {
    if (memo) return memo;
    memo = resolveConfig(process.env);
    return memo;
  }
  return resolveConfig(env);
}

function resolveConfig(env: NodeJS.ProcessEnv): MediaConfig {
  return {
    secret: resolveSecret(env),
    previous: resolvePrevious(env),
    ttlMinutes: resolveTtl(env),
    mode: resolveMode(env),
  };
}

export function __resetMediaConfigForTests(): void {
  memo = null;
}

/** e = (floor(t/W)+2)*W in seconds; windowStart = floor(t/W)*W. */
export function mediaWindow(now: Date, ttlMinutes: number): { windowStart: Date; expiresAt: number } {
  const w = ttlMinutes * 60;
  const t = Math.floor(now.getTime() / 1000);
  const start = Math.floor(t / w) * w;
  return { windowStart: new Date(start * 1000), expiresAt: start + 2 * w };
}

function hmac(secret: Buffer, root: MediaRoot, key: string, e: number): Buffer {
  return createHmac('sha256', secret).update(`v1\n${root}\n${key}\n${e}`).digest();
}

function decodeKey(rawPath: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(rawPath.startsWith('/') ? rawPath.slice(1) : rawPath);
  } catch {
    return null;
  }
  if (key.endsWith('/') || !isValidKey(key)) return null;
  return key;
}

function reservedForOtherRoot(root: MediaRoot, key: string): boolean {
  return root === 'illustrations' && key.split('/')[0] === 'uploads';
}

const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');

/** Canonical '/illustrations/<key>' | '/uploads/<key>' -> signed path. Unchanged if not a valid media path. */
export function signMediaPath(path: string, now: Date = new Date(), cfg: MediaConfig = getMediaConfig()): string {
  if (typeof path !== 'string') return path;
  const canonical = mediaPath(path);
  if (!MEDIA_PATH_RE.test(canonical)) return path;
  const slash = canonical.indexOf('/', 1);
  const root = canonical.slice(1, slash) as MediaRoot;
  const key = decodeKey(canonical.slice(slash + 1));
  if (key === null || reservedForOtherRoot(root, key)) return path;
  const e = mediaWindow(now, cfg.ttlMinutes).expiresAt;
  const s = hmac(cfg.secret, root, key, e).toString('base64url');
  return `/${root}/${encodeKey(key)}?${MEDIA_EXPIRES_PARAM}=${e}&${MEDIA_SIG_PARAM}=${s}`;
}

export type VerifyResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'too-far' | 'bad-signature' };

/** `rawPath` is req.path relative to the mount (still percent-encoded). */
export function verifyMediaRequest(
  root: MediaRoot,
  rawPath: string,
  query: Record<string, unknown>,
  now: Date = new Date(),
  cfg: MediaConfig = getMediaConfig(),
): VerifyResult & { key?: string } {
  if (!MEDIA_ROOTS.includes(root)) return { ok: false, reason: 'malformed' };
  const key = decodeKey(rawPath) ?? undefined;
  const eRaw = query[MEDIA_EXPIRES_PARAM];
  const sRaw = query[MEDIA_SIG_PARAM];
  if (eRaw === undefined || sRaw === undefined) return { ok: false, reason: 'missing', key };
  if (key === undefined || reservedForOtherRoot(root, key)) return { ok: false, reason: 'malformed' };
  if (typeof eRaw !== 'string' || typeof sRaw !== 'string') return { ok: false, reason: 'malformed', key };
  if (!/^\d{1,15}$/.test(eRaw) || !/^[A-Za-z0-9_-]+$/.test(sRaw)) return { ok: false, reason: 'malformed', key };

  const e = Number(eRaw);
  const nowS = Math.floor(now.getTime() / 1000);
  if (e * 1000 <= now.getTime()) return { ok: false, reason: 'expired', key };
  if (e > nowS + 2 * cfg.ttlMinutes * 60 + FUTURE_SLACK_S) return { ok: false, reason: 'too-far', key };

  const given = Buffer.from(sRaw, 'base64url');
  if (given.length !== 32) return { ok: false, reason: 'bad-signature', key };
  for (const secret of cfg.previous ? [cfg.secret, cfg.previous] : [cfg.secret]) {
    if (timingSafeEqual(given, hmac(secret, root, key, e))) return { ok: true, expiresAt: e, key };
  }
  return { ok: false, reason: 'bad-signature', key };
}
