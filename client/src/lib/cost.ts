// Per-image generation cost for the active image provider.
// Single source of truth for every cost-copy site in the client — a future
// provider/price change is a one-line edit. Both Fal Flux Pro 1.1 (prompt-only
// pages/portraits) and Fal Flux Kontext (reference-bearing pages) are flat
// $0.04/image, so there is exactly ONE price constant — do not add a second.
// No per-request UI provider picker exists, so this is a build-time constant,
// not wired to a server response.
export const PER_IMAGE_COST_USD = 0.04

// USD formatter used by every cost-copy builder.
export const fmtUsd = (n: number): string => `$${n.toFixed(2)}`

// Portrait-step cost note (IV2 Phase 2). Counts one portrait per required
// character (primary + antagonist) plus the regenerate price. Mirrors the
// laterClickCostNote pattern; reuses the single PER_IMAGE_COST_USD constant.
export const portraitStepCostNote = (requiredCharCount: number): string =>
  `~${fmtUsd(requiredCharCount * PER_IMAGE_COST_USD)} to generate one portrait per ` +
  `required character. Each regenerate is ~${fmtUsd(PER_IMAGE_COST_USD)}.`
