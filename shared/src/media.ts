// Media URL helpers shared by client and server. Plain functions and constants,
// no Zod schema, so this is not a wire-shape change. See
// .code-captain/specs/signed-media-urls/spec.md (decision 2).
//
// Rule: outbound media URLs are always signed (`?e=<unix-seconds>&s=<sig>`),
// inbound ones are always canonicalised with `mediaPath()`, and the database
// only ever holds what `mediaPath()` returns.

export const MEDIA_EXPIRES_PARAM = 'e';
export const MEDIA_SIG_PARAM = 's';
export const MEDIA_ROOTS = ['illustrations', 'uploads'] as const;
export type MediaRoot = (typeof MEDIA_ROOTS)[number];

/** Matches a stored or signed media path: /illustrations/... or /uploads/... */
export const MEDIA_PATH_RE = /^\/(illustrations|uploads)\/[^?#]+/;

/** Strips ?query and #hash. Non-media strings are only stripped. Never throws. */
export function mediaPath(url: string): string;
export function mediaPath(url: null | undefined): null;
export function mediaPath(url: string | null | undefined): string | null;
export function mediaPath(url: string | null | undefined): string | null {
  if (url == null) return null;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Epoch ms from the `e` param, or null when absent or not a plain integer. Never throws. */
export function mediaExpiresAt(url: string | null | undefined): number | null {
  if (typeof url !== 'string') return null;
  const q = url.indexOf('?');
  if (q === -1) return null;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash === -1 ? undefined : hash);
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    const name = eq === -1 ? pair : pair.slice(0, eq);
    if (name !== MEDIA_EXPIRES_PARAM) continue;
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    if (!/^\d{1,15}$/.test(value)) return null;
    return Number(value) * 1000;
  }
  return null;
}
