import { z } from 'zod';

// ---------------------------------------------------------------------------
// Hero rotation — the best-of pool (spec: .code-captain/specs/hero-rotation/)
//
// GET /api/hero/pool returns the ordered frames the Home hero rotates through
// after first paint. Frame 0 of the on-screen rotation is the *bundled* asset
// in client/src/assets/hero/ and is never described by this schema — only the
// progressive-enhancement frames served from server/public/hero/ are.
//
// This route is public and has no auth middleware, deliberately: the pool is
// identical for every visitor. See spec §"The consent seam".
// ---------------------------------------------------------------------------

export const HeroFrameSchema = z.object({
  // `${book_id}-p${page_number}` — stable React key across re-renders.
  id: z.string(),

  // Provenance discriminator, and the third of the four consent seams.
  //
  // It reads like dead weight while 'pool' is the only value, and it is not:
  // the follow-on `hero-personal` spec adds frames drawn from a signed-in
  // reader's own books, carrying `source: 'personal'`. Because this schema
  // pins the literal, a personal frame that ever escapes down the *pool*
  // route fails response validation — a loud 500 in dev, i.e. a red test —
  // instead of quietly publishing one reader's art to every stranger.
  // Deleting this field deletes that tripwire. Keep it.
  source: z.literal('pool'),

  // Server-relative path (`/hero/<book_id>/p<n>-960.webp`). The client wraps
  // it in api() the same way it wraps page.illustration_url — an absolute URL
  // here would break the VITE_API_BASE_URL split between Pages and Render.
  src: z.string(),
  src_small: z.string(), // the 480 variant

  // Intrinsic dimensions, so the client can reserve the box and keep CLS at 0.
  width: z.number().int(),
  height: z.number().int(),

  alt: z.string(),
  book_id: z.string(),

  // Carried for a future credit line (spec §Out of scope: attribution).
  // Unrendered in v1 — on the wire so adding it needs no schema change.
  book_title: z.string(),
});
export type HeroFrame = z.infer<typeof HeroFrameSchema>;

export const HeroPoolResponseSchema = z.object({
  frames: z.array(HeroFrameSchema),
});
export type HeroPoolResponse = z.infer<typeof HeroPoolResponseSchema>;
