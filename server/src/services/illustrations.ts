import { writeFile, mkdir, readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import prisma from '../db/prisma';
import type { Character } from '../types';
import { FalImageGenerator } from './providers/fal';
import type { ImagePin, ImageProvider } from './imagePin';

const ILLUSTRATIONS_DIR = join(import.meta.dirname, '../../public/illustrations');

// PORTRAIT SLOT SENTINEL (IV2 Phase 2).
// Per-character portrait version history is stored in the SAME
// `IllustrationVersion` table as page illustrations (no new table — see spec
// "Schema / contract changes"). To keep portrait rows from colliding with real
// page rows we overload `page_number` with a reserved high offset: a portrait's
// slot = PORTRAIT_SLOT_BASE + characterIndex.
//
// Real pages are 1..MAX_PAGES (MAX_PAGES = 15, see routes/generate.ts), so any
// value >= 1000 can NEVER collide with a page number. 1000 also leaves a wide
// gap (16..999) as a safety buffer if MAX_PAGES is ever raised. The existing
// @@unique([book_id, page_number, version]) then gives per-character version
// numbering for free, exactly as it does for pages.
//
// This sentinel-overload (vs. a dedicated CharacterPortrait table) is an
// ADR-worthy sub-decision tracked in tasks.md Task 9.
const PORTRAIT_SLOT_BASE = 1000;

// Encode a character's array index into its reserved portrait page_number slot.
function portraitSlot(characterIndex: number): number {
  return PORTRAIT_SLOT_BASE + characterIndex;
}

// Collect the reference-portrait paths to feed page/cover generation (IV2
// Phase 2). Per the spec's "required character" definition, only PRIMARY and
// ANTAGONIST roles are identity-critical recurring figures — supporting
// characters are intentionally NOT forced as references (cost vs. completeness;
// spec ADR-worthy decision "Required character = primary + antagonist only").
//
// Phase 2 does NOT do per-page character detection: the same required-cast
// portraits are passed to EVERY page/cover. Precise per-page casting is out of
// scope (spec "Out of scope").
//
// Returns the portrait_url web paths ('/illustrations/<id>/portrait-<slot>.png')
// of the required characters that HAVE a portrait. When no required character
// has a portrait yet (the common case before the cast is approved), this returns
// an empty array and the caller passes NO referenceImages — the byte-identical
// prompt-only fallback (regression-safe; a portrait-less book illustrates
// exactly as IV1/today, no 403).
const REQUIRED_PORTRAIT_ROLES = new Set<Character['role']>(['primary', 'antagonist']);

export function collectRequiredPortraitRefs(characters?: Character[]): string[] {
  if (!characters || characters.length === 0) return [];
  return characters
    .filter(c => REQUIRED_PORTRAIT_ROLES.has(c.role) && !!c.portrait_url)
    .map(c => c.portrait_url as string);
}

function formatCastPrefix(characters?: Character[]): string {
  if (!characters || characters.length === 0) return '';
  const cast = characters
    .map(c => `${c.name}${c.descriptor ? ` (${c.descriptor})` : ''}`)
    .join('; ');
  return `Cast (keep these characters visually consistent): ${cast}. `;
}

interface OpenAIImageItem {
  url?: string;
  b64_json?: string;
}

// Optional generation inputs that a provider may use to influence the output
// beyond the prompt text. Phase 2 (IV2) introduces `referenceImages`: a list
// of on-disk illustration paths (e.g. '/illustrations/<bookId>/portrait-<slot>.png')
// that a generator resolves to data-URIs/URLs and feeds as character references.
//
// REGRESSION-SAFE CONTRACT: when `referenceImages` is absent or empty, EVERY
// generator MUST behave exactly as today (byte-identical request). The actual
// reference-bearing model branching (Fal Kontext / OpenAI image-input) lands in
// a later task; the option is threaded here without changing behavior.
export interface ImageGenOptions {
  referenceImages?: string[];
}

// Per-call generation context, threaded from the route into the public service
// functions as a TRAILING options object rather than a 9th positional argument.
// The existing positional arguments are deliberately left alone so the route
// tests' `mock.calls[n][6]` reference-image assertions keep holding; the options
// land at [7] (or [6] for generateCharacterPortrait).
//
//   pin         which provider + base model serves THIS book. Resolved by
//               services/imagePin.ts. Absent = the environment default, which
//               is exactly today's behaviour.
//   styleAnchor the page's own existing illustration, used to shape the prompt.
//               Threaded here but IGNORED until Task 7 — the no-anchor path
//               must stay byte-identical (ADR-006 dec 3 / ADR-007 dec 3).
export interface GenerationPin {
  pin?: ImagePin;
  styleAnchor?: string | null;
}

// Resolve a reference web path ('/illustrations/<bookId>/<file>.png') to raw
// bytes, read from the same on-disk base illustrations are written to. Used by
// the OpenAI image-input path (the Fal path has its own data-URI resolver).
// Throws clearly when the file is missing so an absent portrait surfaces rather
// than producing a malformed upload.
async function resolveReferenceBytes(referencePath: string): Promise<Buffer> {
  const rel = referencePath.replace(/^\/?illustrations\//, '');
  const absPath = join(ILLUSTRATIONS_DIR, rel);
  try {
    return await readFile(absPath);
  } catch {
    throw new Error(`Reference image not found on disk: ${referencePath} (resolved to ${absPath})`);
  }
}

// Provider abstraction for image generation. Implementations own only the
// network call: they take a fully-assembled prompt and return raw image
// bytes. Versioning, on-disk writes, and the illustrationVersion Prisma row
// stay in the public service functions (generateIllustration/generateCover),
// so persistence is provider-agnostic. Phase 1 ships OpenAI; Fal is added in
// a later task.
//
// `opts` is optional and, when absent/empty, MUST be ignored so the no-reference
// path stays byte-identical to IV1 (regression boundary; extends ADR-006 dec 3).
export interface ImageGenerator {
  readonly name: 'openai' | 'fal';
  generate(prompt: string, opts?: ImageGenOptions): Promise<Buffer>;
}

// Cap a single image-generation request at 120s. Without this, a hung
// response from OpenAI (or an intermediary like a corporate proxy that
// drops the connection silently) leaves the route handler awaiting forever
// and the client sees nothing actionable. 120s is a generous upper bound —
// gpt-image-1 typically responds in 10-30s.
const OPENAI_IMAGE_TIMEOUT_MS = 120_000;

class OpenAIImageGenerator implements ImageGenerator {
  readonly name = 'openai' as const;

  // The model id is a constructor argument so a pinned book can force the model
  // that actually produced its art (see services/imagePin.ts). It defaults to
  // the same OPENAI_IMAGE_MODEL || 'gpt-image-1' expression the module-level
  // constant used to hold — one source of truth, read per construction rather
  // than once at import.
  constructor(private readonly model: string = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1') {}

  // Model selection (IV2 Phase 2 — gpt-image-1):
  //   - no references  -> POST /v1/images/generations  (JSON body, UNCHANGED)
  //   - with refs      -> POST /v1/images/edits         (multipart/form-data;
  //                       the reference image(s) ride in the `image[]` slot,
  //                       which gpt-image-1's edit endpoint accepts as visual
  //                       input — the generations endpoint takes no image input).
  // Both endpoints return the same { data: [{ b64_json | url }] } shape, so the
  // response-parsing leg below is shared. Branch on referenceImages?.length;
  // undefined and [] are treated identically (prompt-only, byte-identical IV1).
  async generate(prompt: string, opts?: ImageGenOptions): Promise<Buffer> {
    const apiKey = process.env.OPENAI_API_KEY!;
    const references = opts?.referenceImages ?? [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_IMAGE_TIMEOUT_MS);

    let res: Response;
    try {
      if (references.length > 0) {
        // Image-input path: gpt-image-1 edit endpoint, multipart form-data.
        const form = new FormData();
        form.append('model', this.model);
        form.append('prompt', prompt);
        form.append('n', '1');
        form.append('size', '1024x1024');
        for (const ref of references) {
          const bytes = await resolveReferenceBytes(ref);
          form.append('image[]', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'reference.png');
        }
        res = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: {
            // No Content-Type — fetch sets the multipart boundary from FormData.
            'Authorization': `Bearer ${apiKey}`,
          },
          body: form,
          signal: controller.signal,
        });
      } else {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            prompt,
            n: 1,
            size: '1024x1024',
          }),
          signal: controller.signal,
        });
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new Error(`OpenAI image request timed out after ${OPENAI_IMAGE_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text();
      console.error(`OpenAI image error (${this.model}):`, err);
      const snippet = err.slice(0, 500);
      throw new Error(`OpenAI image API returned ${res.status} ${res.statusText || ''}: ${snippet}`);
    }

    const data = await res.json() as { data: OpenAIImageItem[] };
    const item = data.data[0];
    if (!item) {
      throw new Error('OpenAI image response had no data entries');
    }

    if (item.b64_json) {
      return Buffer.from(item.b64_json, 'base64');
    }
    if (item.url) {
      const imageRes = await fetch(item.url);
      if (!imageRes.ok) {
        throw new Error(`Failed to download generated image: ${imageRes.status} ${imageRes.statusText || ''}`);
      }
      return Buffer.from(await imageRes.arrayBuffer());
    }

    throw new Error('OpenAI image response had neither b64_json nor url');
  }
}

// Provider selection. With NO pin this is unchanged: the selector env var is
// IMAGE_PROVIDER and defaults to 'fal' (ADR-006 decision 2). 'openai' resolves
// to OpenAIImageGenerator; 'fal' (and the default) resolves to
// FalImageGenerator (raw fetch to Flux Pro 1.1, see providers/fal.ts).
//
// With a pin, the BOOK decides — IMAGE_PROVIDER no longer governs a book that
// already has art (partial supersession of ADR-006 dec 2). The pin's model is
// handed to the generator's constructor so a book drawn on gpt-image-1 in May
// re-rolls on gpt-image-1, not on whatever today's env happens to default to.
export function getImageGenerator(pin?: ImagePin): ImageGenerator {
  const provider = pin?.provider ?? process.env.IMAGE_PROVIDER ?? 'fal';
  switch (provider) {
    case 'openai':
      return new OpenAIImageGenerator(pin?.model);
    case 'fal':
    default:
      return new FalImageGenerator(pin?.model);
  }
}

// Provider-aware replacement for the literal OPENAI_API_KEY route/service
// gates. Returns true iff a provider's key env var is present:
//   provider 'openai' -> !!process.env.OPENAI_API_KEY
//   provider 'fal'    -> !!process.env.FAL_KEY
//
// With NO argument this reports on the ENVIRONMENT DEFAULT, exactly as it
// always has — callers that predate the pin are unaffected. With an argument it
// reports on THAT provider, which is what lets a route distinguish "nothing is
// configured" (501) from "this book needs a provider this server doesn't have"
// (409, wired in Task 5).
export function isImageGenConfigured(provider?: ImageProvider): boolean {
  const selected = provider ?? process.env.IMAGE_PROVIDER ?? 'fal';
  if (selected === 'openai') {
    return !!process.env.OPENAI_API_KEY;
  }
  return !!process.env.FAL_KEY;
}

export async function generateIllustration(
  bookId: string,
  pageNumber: number,
  description: string,
  feedback?: string,
  styleDescriptor?: string | null,
  characters?: Character[],
  referenceImages?: string[],
  opts?: GenerationPin,
): Promise<string | null> {
  // Gate on the PINNED provider when there is one: a book pinned to a provider
  // this server has no key for must return null rather than quietly generating
  // on the wrong model — that silent fallback is the reported bug.
  if (!isImageGenConfigured(opts?.pin?.provider)) return null;

  const style = styleDescriptor?.trim() || 'Whimsical, colorful, warm, suitable for young children';
  const castPrefix = formatCastPrefix(characters);
  let prompt = `${castPrefix}Children's book illustration, ${description}. ${style}. No text or words in the image.`;
  if (feedback) {
    prompt += ` Revision instructions: ${feedback}`;
  }

  // Forward referenceImages only when present, so callers that pass nothing
  // get the byte-identical no-reference path (regression-safe). The provider
  // ignores empty/absent references in this task.
  const buffer = await getImageGenerator(opts?.pin).generate(prompt, { referenceImages });

  const dir = join(ILLUSTRATIONS_DIR, bookId);
  await mkdir(dir, { recursive: true });

  const version = await getNextVersion(dir, pageNumber);
  const filename = version === 1
    ? `page-${pageNumber}.png`
    : `page-${pageNumber}-v${version}.png`;
  await writeFile(join(dir, filename), buffer);

  const url = `/illustrations/${bookId}/${filename}`;

  await prisma.illustrationVersion.create({
    data: {
      book_id: bookId,
      page_number: pageNumber,
      version,
      url,
      feedback: feedback ?? null,
    },
  });

  return url;
}

async function getNextVersion(dir: string, pageNumber: number): Promise<number> {
  try {
    const files = await readdir(dir);
    const pattern = new RegExp(`^page-${pageNumber}(-v(\\d+))?\\.png$`);
    let max = 0;
    for (const f of files) {
      const m = f.match(pattern);
      if (m) max = Math.max(max, m[2] ? parseInt(m[2]) : 1);
    }
    return max + 1;
  } catch {
    return 1;
  }
}

// Portrait analogue of getNextVersion: scans portrait-<slot>(-v<n>).png in the
// book's illustration dir and returns the next version number. Mirrors the page
// versioning scheme so a regenerate bumps to v2, v3, ...
async function getNextPortraitVersion(dir: string, slot: number): Promise<number> {
  try {
    const files = await readdir(dir);
    const pattern = new RegExp(`^portrait-${slot}(-v(\\d+))?\\.png$`);
    let max = 0;
    for (const f of files) {
      const m = f.match(pattern);
      if (m) max = Math.max(max, m[2] ? parseInt(m[2]) : 1);
    }
    return max + 1;
  } catch {
    return 1;
  }
}

export interface IllustrationVersionRecord {
  url: string;
  version: number;
  created_at: string;
  feedback: string | null;
}

export async function listIllustrationVersions(
  bookId: string,
  pageNumber: number,
): Promise<IllustrationVersionRecord[]> {
  const rows = await prisma.illustrationVersion.findMany({
    where: { book_id: bookId, page_number: pageNumber },
    orderBy: { version: 'asc' },
  });

  if (rows.length > 0) {
    return rows.map(r => ({
      url: r.url,
      version: r.version,
      created_at: r.created_at.toISOString(),
      feedback: r.feedback,
    }));
  }

  // Backwards-compatibility fallback: books generated before the
  // IllustrationVersion table existed only have files on disk and no DB rows.
  // We synthesize records from the filesystem so the history viewer still
  // renders them. created_at uses the file mtime (best-effort) and feedback
  // is null because we never stored it for legacy regens.
  const dir = join(ILLUSTRATIONS_DIR, bookId);
  try {
    const files = await readdir(dir);
    const pattern = new RegExp(`^page-${pageNumber}(?:-v(\\d+))?\\.png$`);
    const synthesized: IllustrationVersionRecord[] = [];
    for (const f of files) {
      const m = f.match(pattern);
      if (!m) continue;
      const version = m[1] ? parseInt(m[1], 10) : 1;
      let created_at = new Date(0).toISOString();
      try {
        const s = await stat(join(dir, f));
        created_at = s.mtime.toISOString();
      } catch {
        // mtime read failed — keep the epoch sentinel
      }
      synthesized.push({
        url: `/illustrations/${bookId}/${f}`,
        version,
        created_at,
        feedback: null,
      });
    }
    synthesized.sort((a, b) => a.version - b.version);
    return synthesized;
  } catch {
    return [];
  }
}

// Assemble a single-character portrait prompt. Unlike page/cover prompts there
// is no cast prefix (a portrait is ONE character) and no "no text" /
// cover-composition rules — just a clean character-sheet style portrait so it
// reads as a canonical reference. Style descriptor keeps the portrait in the
// same visual register as the book's pages.
function formatPortraitPrompt(
  name: string,
  descriptor: string | undefined,
  style: string,
): string {
  const who = descriptor?.trim() ? `${name}, ${descriptor.trim()}` : name;
  return `Children's book character portrait of ${who}. Single character, ` +
    `centered, clear view of the face and full character design, neutral ` +
    `background — a canonical character reference sheet. ${style}.`;
}

// Generate (or regenerate) one character's canonical portrait.
//
// Portrait generation is PROMPT-ONLY: the portrait IS the reference, so there
// is nothing to reference yet. It runs on the current provider's prompt-only
// path (Flux Pro 1.1 / gpt-image-1 generations), NEVER the Kontext/edit
// reference path — we deliberately pass NO referenceImages.
//
// Writes public/illustrations/<bookId>/portrait-<slot>(-v<n>).png, records an
// IllustrationVersion row in the portrait slot (page_number = the sentinel
// slot), and returns the new portrait URL. It does NOT mutate characters_json —
// repointing portrait_url is the route's job (Task 5), mirroring how
// generateIllustration returns a URL the caller persists.
//
// Returns null when image generation is not configured (mirrors
// generateIllustration), so the route can 501 uniformly.
export async function generateCharacterPortrait(
  bookId: string,
  characterIndex: number,
  name: string,
  descriptor?: string,
  feedback?: string,
  styleDescriptor?: string | null,
  opts?: GenerationPin,
): Promise<string | null> {
  // See generateIllustration: the pinned provider gates, not the env default.
  if (!isImageGenConfigured(opts?.pin?.provider)) return null;

  const style = styleDescriptor?.trim() || 'Whimsical, colorful, warm, suitable for young children';
  let prompt = formatPortraitPrompt(name, descriptor, style);
  if (feedback) {
    prompt += ` Revision instructions: ${feedback}`;
  }

  // Prompt-only on purpose — no referenceImages passed (regression-safe path).
  const buffer = await getImageGenerator(opts?.pin).generate(prompt);

  const dir = join(ILLUSTRATIONS_DIR, bookId);
  await mkdir(dir, { recursive: true });

  const slot = portraitSlot(characterIndex);
  const version = await getNextPortraitVersion(dir, slot);
  const filename = version === 1
    ? `portrait-${slot}.png`
    : `portrait-${slot}-v${version}.png`;
  await writeFile(join(dir, filename), buffer);

  const url = `/illustrations/${bookId}/${filename}`;

  await prisma.illustrationVersion.create({
    data: {
      book_id: bookId,
      page_number: slot,
      version,
      url,
      feedback: feedback ?? null,
    },
  });

  return url;
}

// List one character's portrait version history, ascending by version. Reads
// the portrait slot in IllustrationVersion and reuses the same row->record
// mapping as listIllustrationVersions. No filesystem-synthesis fallback:
// portraits only ever exist post-IV2, so there are no legacy file-only rows.
export async function listCharacterPortraitVersions(
  bookId: string,
  characterIndex: number,
): Promise<IllustrationVersionRecord[]> {
  const rows = await prisma.illustrationVersion.findMany({
    where: { book_id: bookId, page_number: portraitSlot(characterIndex) },
    orderBy: { version: 'asc' },
  });

  return rows.map(r => ({
    url: r.url,
    version: r.version,
    created_at: r.created_at.toISOString(),
    feedback: r.feedback,
  }));
}

export async function generateCover(
  bookId: string,
  title: string,
  description: string,
  styleDescriptor?: string | null,
  characters?: Character[],
  referenceImages?: string[],
  opts?: GenerationPin,
): Promise<string | null> {
  // See generateIllustration: the pinned provider gates, not the env default.
  if (!isImageGenConfigured(opts?.pin?.provider)) return null;

  const style = styleDescriptor?.trim() || 'Whimsical, colorful, warm, suitable for young children';
  const castPrefix = formatCastPrefix(characters);
  const prompt = `${castPrefix}Children's book cover illustration for a story titled "${title}". Scene: ${description}. ${style}. Composition suitable for a book cover (centered subject, room at top for title). No text or words in the image.`;

  // See generateIllustration: forward references only when present; absent/empty
  // keeps the no-reference path byte-identical.
  const buffer = await getImageGenerator(opts?.pin).generate(prompt, { referenceImages });

  const dir = join(ILLUSTRATIONS_DIR, bookId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'cover.png'), buffer);

  return `/illustrations/${bookId}/cover.png`;
}
