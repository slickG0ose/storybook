// Build-time switch for the commerce surface (prices, cart, checkout).
// This module is the only place that reads VITE_COMMERCE_ENABLED.

const OFF_VALUES = new Set(['false', '0', 'off', 'no'])

/** Off only for an explicit off value; unset, empty or unrecognised means on. */
export function parseCommerceFlag(raw: string | undefined): boolean {
  if (raw === undefined) return true
  return !OFF_VALUES.has(raw.trim().toLowerCase())
}

/** Read at call time so Vitest can stub the env; statically replaced in a Vite build. */
export function commerceEnabled(): boolean {
  return parseCommerceFlag(import.meta.env.VITE_COMMERCE_ENABLED)
}
