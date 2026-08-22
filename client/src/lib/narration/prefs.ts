/**
 * Narration preferences, stored under one namespaced localStorage key.
 *
 * Device-scoped by nature: the available voice list *is* the device, so a voice chosen
 * on an iPhone does not exist on a Windows laptop. That is why these live here rather
 * than on the `User` record — persisting them server-side would buy a Prisma migration,
 * a route, and a wire shape in exchange for syncing a setting that cannot sync.
 *
 * Validation is a hand-written guard rather than Zod: there is no wire shape here, and
 * `zod` is not a direct `client/` dependency.
 *
 * CLAUDE.md guardrail — this module reads and writes exactly one key. It never touches
 * `storybook-session`, `storybook-auth`, `storybook-theme`, or `storybook-cart-cache`.
 */
const NARRATION_PREFS_KEY = 'storybook-narration'

export interface NarrationPrefs {
  voiceURI: string | null;
  /** Clamped to [MIN_RATE, MAX_RATE]. */
  rate: number;
  autoAdvance: boolean;
}

export const DEFAULT_PREFS: NarrationPrefs = { voiceURI: null, rate: 1, autoAdvance: true }

/**
 * Rendered as a native `<select>`, not a slider: a slider is a poor tap target, and
 * below ~0.75 most engines sound slurred rather than slower.
 */
export const RATE_OPTIONS = [0.75, 1, 1.25, 1.5] as const

export const MIN_RATE = 0.75
export const MAX_RATE = 1.5

export function clampRate(rate: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
}

/**
 * Never throws. Returns `DEFAULT_PREFS` on missing, malformed, or out-of-range values.
 *
 * Each field is guarded independently, so one bad field falls back to its own default
 * instead of discarding a blob that is otherwise fine — a stale build or a hand-edited
 * devtools value should cost the user one setting, not all three.
 */
export function readPrefs(): NarrationPrefs {
  let raw: string | null
  try {
    raw = localStorage.getItem(NARRATION_PREFS_KEY)
  } catch {
    // Storage can throw outright (Safari private mode, blocked third-party storage).
    return { ...DEFAULT_PREFS }
  }
  if (raw === null) return { ...DEFAULT_PREFS }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_PREFS }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_PREFS }
  }

  const record = parsed as Record<string, unknown>

  const voiceURI = typeof record.voiceURI === 'string' ? record.voiceURI : DEFAULT_PREFS.voiceURI
  const rate =
    typeof record.rate === 'number' && Number.isFinite(record.rate)
      ? clampRate(record.rate)
      : DEFAULT_PREFS.rate
  const autoAdvance =
    typeof record.autoAdvance === 'boolean' ? record.autoAdvance : DEFAULT_PREFS.autoAdvance

  // Unknown extra keys are ignored rather than preserved: the blob is ours, and echoing
  // back fields we do not understand would let an old shape outlive its own code.
  return { voiceURI, rate, autoAdvance }
}

/**
 * Best-effort write. A reader that crashes because a *preference* could not be saved is
 * a worse bug than a lost preference, so quota and security errors are swallowed.
 *
 * Normalises on the way out as well as on the way in — an out-of-range `rate` makes some
 * engines refuse to speak at all, and defence in depth is cheap here.
 */
export function writePrefs(prefs: NarrationPrefs): void {
  const normalised: NarrationPrefs = {
    voiceURI: typeof prefs.voiceURI === 'string' ? prefs.voiceURI : null,
    rate: Number.isFinite(prefs.rate) ? clampRate(prefs.rate) : DEFAULT_PREFS.rate,
    autoAdvance: prefs.autoAdvance === true,
  }

  try {
    localStorage.setItem(NARRATION_PREFS_KEY, JSON.stringify(normalised))
  } catch {
    // QuotaExceededError / SecurityError — degrade to "preference not remembered".
  }
}
