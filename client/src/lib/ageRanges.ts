// The canonical age-range vocabulary lives in @storybook/shared so the client and
// the server cannot diverge (#172 — CreateBook once offered 2-4/6-10, which the
// seed catalog never used). Re-exported here because pages must not import
// @storybook/shared directly (docs/conventions/call-graph.md), and AGE_RANGES is a
// value, not a type, so it cannot ride the types-only client/src/types.ts barrel.
export { AGE_RANGES } from '@storybook/shared'
export type { AgeRange } from '@storybook/shared'
