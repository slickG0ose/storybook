import { z } from 'zod';
import { AgeRangeSchema } from './books';

// ---------------------------------------------------------------------------
// POST /api/generate — request body (#172)
//
// Every field the handler reads must be listed here: `validate()` replaces
// `req.body` with the parsed value and `z.object` strips unknown keys, so an
// omission silently deletes a feature (e.g. drop `styleReferenceUrl` and style
// references stop reaching the DB). Nine fields, matching the handler's reads
// in server/src/routes/generate.ts.
//
// Only `theme` and `ageRange` tighten. Everything else preserves today's
// tolerance, because the handler already normalises it:
//   - `characters` stays loose. normalizeCharacters() FILTERS entries with a
//     junk role or a missing name rather than rejecting the request; a strict
//     CharacterSchema here would turn those silent drops into 400s, which is a
//     different contract change riding along on this one.
//   - `previewMode` / `pageCount` keep their handler-side normalisers
//     (VALID_PREVIEW_MODES fallback to 'quick', normalizePageCount() clamp to
//     3–15), so a junk value still normalises rather than 400s. Tightening them
//     is deliberately out of scope — see the spec's §Out of scope.
//   - "at least one primary character" stays a handler check: it is a
//     cross-field rule over the legacy `characterName` path and the
//     `characters` array, not expressible per-field.
//
// No response schema. This route has never had one; adding it is its own slice.
// ---------------------------------------------------------------------------
export const GenerateRequestSchema = z.object({
  theme: z.string().min(1),
  ageRange: AgeRangeSchema,
  additionalDetails: z.string().optional(),
  characterName: z.string().optional(),
  characters: z
    .array(
      // looseObject (not z.object): unknown keys pass through instead of being
      // stripped, and every field is optional, so a malformed entry survives
      // parsing and reaches normalizeCharacters() to be dropped there.
      z.looseObject({
        role: z.string().optional(),
        name: z.string().optional(),
        descriptor: z.string().optional(),
        relationship: z.string().optional(),
      }),
    )
    .optional(),
  styleDescriptor: z.string().optional(),
  styleReferenceUrl: z.string().optional(),
  previewMode: z.string().optional(), // normalised by VALID_PREVIEW_MODES in the handler
  pageCount: z.unknown().optional(), // normalised/clamped by normalizePageCount()
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
