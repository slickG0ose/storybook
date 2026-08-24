/**
 * Is an API-key env var actually usable, or is it still the template's filler?
 *
 * Presence is not usability. Every `.env.example` in this repo ships a line for
 * each provider key, and a developer who copies the template to `.env` without
 * filling it in has a key that is *set* but guaranteed to 401. A presence-only
 * check calls the provider anyway, so the caller gets an opaque 500 carrying a
 * vendor stack trace instead of the honest "not configured" answer the route
 * already knows how to give:
 *
 *   - image generation → 409/501 per ADR-013 dec 5 ("a book pinned to a
 *     provider this server has no key for returns 409 — never a silent
 *     fallback"), the bug this predicate was written for;
 *   - story generation + style-reference upload → the same
 *     `ANTHROPIC_API_KEY not configured` / descriptor-less response those
 *     routes return when the var is genuinely absent.
 *
 * Lives in `lib/` rather than next to any one provider because all three
 * consumers — `services/illustrations.ts`, `routes/generate.ts`,
 * `routes/books.ts`, `routes/uploads.ts` — are answering the same question
 * about different vendors. It imports nothing, so it can't create a cycle.
 */

// Deliberately conservative, and the asymmetry is the whole design: a FALSE
// POSITIVE here locks a user out of a key that is genuinely fine, which is
// worse than the bug being fixed. So this matches only well-known placeholder
// SHAPES and never validates real key formats — no `sk-` prefix requirement, no
// length floor, no charset rule. Vendors change those; a config template's
// filler text does not.
const PLACEHOLDER_KEY_PATTERNS: readonly RegExp[] = [
  /^<.*>$/, // <your-api-key>, <fill me in> — anything still in angle brackets
  /^your-[a-z0-9-]*key(-here)?$/, // your-api-key-here (the .env.example literal), your-openai-key
  /^change-?me(-here)?$/,
  /^x{3,}$/, // xxx, xxxxxxxxxxxx
  /^placeholder$/,
  /^todo$/,
];

export function isUsableApiKey(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  // Underscores and inner whitespace fold to dashes so `YOUR_API_KEY_HERE` and
  // `your-api-key-here` are one placeholder, which is how templates in the wild
  // actually vary. Case is folded for the same reason.
  const normalized = trimmed.toLowerCase().replace(/[\s_]+/g, '-');
  return !PLACEHOLDER_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}
