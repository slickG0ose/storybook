import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ImageGenerator, ImageGenOptions } from '../illustrations';

// Reference portraits are written by the service to
// server/public/illustrations/<bookId>/portrait-<slot>.png and carried on the
// wire as web paths ('/illustrations/<bookId>/portrait-<slot>.png'). To resolve
// a web path back to bytes we strip the leading '/illustrations/' segment and
// join against the same on-disk base the service writes to. Mirrors
// ILLUSTRATIONS_DIR in illustrations.ts (../../public/illustrations from this
// file's dir, which sits one level deeper under services/providers/).
const ILLUSTRATIONS_DIR = join(import.meta.dirname, '../../../public/illustrations');

// Cap a single Fal image-generation request at 120s — parity with the OpenAI
// path (OPENAI_IMAGE_TIMEOUT_MS in illustrations.ts). Flux Pro 1.1's
// synchronous endpoint typically responds in ~5-10s, well under this cap, but
// the timeout protects the route handler from a hung/silently-dropped
// connection (e.g. a corporate proxy) the same way the OpenAI path does.
const FAL_IMAGE_TIMEOUT_MS = 120_000;

// Fal's synchronous run response. Flux Pro 1.1 returns the result inline:
//   { images: [{ url, content_type, width, height }], prompt, seed, ... }
// (NOT OpenAI's { data: [{ b64_json | url }] } shape.) We only depend on
// images[0].url and download the bytes ourselves.
interface FalImageItem {
  url?: string;
}

interface FalRunResponse {
  images?: FalImageItem[];
}

/**
 * Fal.ai Flux Pro 1.1 image generator (raw fetch — no @fal-ai/client SDK, per
 * ADR decision 1). Owns ONLY the network call: takes a fully-assembled prompt,
 * returns raw PNG bytes. Versioning + the illustrationVersion Prisma row stay
 * in the public service functions (generateIllustration/generateCover).
 *
 * Endpoint / auth / params pinned against the Fal docs at implementation time
 * (2026-06-05):
 *   - Synchronous run URL:  POST https://fal.run/<model-id>
 *   - Auth header:          Authorization: Key <FAL_KEY>   (Fal convention)
 *
 * Model selection (IV2 Phase 2 — pinned from Fal docs 2026-06-05):
 *   - no references   -> fal-ai/flux-pro/v1.1 (prompt-only, default, UNCHANGED)
 *                        body { prompt, image_size: 'square_hd', num_images: 1,
 *                               output_format: 'png' }
 *   - 1 reference     -> fal-ai/flux-pro/kontext        body { prompt, image_url }
 *   - 2+ references   -> fal-ai/flux-pro/kontext/multi   body { prompt, image_urls: string[] }
 *
 * All three return the SAME response shape — { images: [{ url, ... }], ... } —
 * so the response-parsing + download legs below are shared. Kontext is flat
 * $0.04/image (same as Flux Pro 1.1). image_size 'square_hd' is the square
 * preset (parity with OpenAI's 1024x1024); output_format 'png' matches the
 * OpenAI path's PNG bytes.
 *
 * Reference plumbing (option b, data-URI): each referenceImages entry is an
 * on-disk illustration web path ('/illustrations/<bookId>/portrait-<slot>.png');
 * we read the bytes and inline them as a data:image/png;base64,... URI so Fal
 * needn't reach localhost in dev.
 *
 * FAL_IMAGE_MODEL env override: applies ONLY to the prompt-only (no-reference)
 * path; the reference-bearing path always selects Kontext regardless, since the
 * override default (Flux Pro 1.1) cannot take an input image.
 */
export class FalImageGenerator implements ImageGenerator {
  readonly name = 'fal' as const;

  async generate(prompt: string, opts?: ImageGenOptions): Promise<Buffer> {
    const apiKey = process.env.FAL_KEY!;
    const references = opts?.referenceImages ?? [];

    // Branch on reference presence. undefined and [] are treated identically
    // (prompt-only). The no-reference branch is byte-identical to IV1.
    let modelId: string;
    let body: Record<string, unknown>;
    if (references.length === 0) {
      modelId = process.env.FAL_IMAGE_MODEL || 'fal-ai/flux-pro/v1.1';
      body = {
        prompt,
        image_size: 'square_hd',
        num_images: 1,
        output_format: 'png',
      };
    } else if (references.length === 1) {
      modelId = 'fal-ai/flux-pro/kontext';
      body = {
        prompt,
        image_url: await toDataUri(references[0]),
      };
    } else {
      modelId = 'fal-ai/flux-pro/kontext/multi';
      body = {
        prompt,
        image_urls: await Promise.all(references.map(toDataUri)),
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FAL_IMAGE_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`https://fal.run/${modelId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new Error(`Fal image request timed out after ${FAL_IMAGE_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text();
      console.error(`Fal image error (${modelId}):`, err);
      const snippet = err.slice(0, 500);
      throw new Error(`Fal image API returned ${res.status} ${res.statusText || ''}: ${snippet}`);
    }

    const data = await res.json() as FalRunResponse;
    const item = data.images?.[0];
    if (!item) {
      throw new Error('Fal image response had no images entries');
    }
    if (!item.url) {
      throw new Error('Fal image response had no image url');
    }

    const imageRes = await fetch(item.url);
    if (!imageRes.ok) {
      throw new Error(`Failed to download generated image: ${imageRes.status} ${imageRes.statusText || ''}`);
    }
    return Buffer.from(await imageRes.arrayBuffer());
  }
}

// Resolve a reference web path ('/illustrations/<bookId>/<file>.png') to a
// base64 data URI Fal can consume inline. Reads from the same on-disk base the
// service writes illustrations to. Throws a clear error if the file is missing
// so the caller surfaces a misconfigured/absent portrait rather than silently
// sending a malformed request to Fal.
async function toDataUri(referencePath: string): Promise<string> {
  // Strip the '/illustrations/' web prefix to get the path relative to the
  // illustrations base. Tolerate an absent leading slash defensively.
  const rel = referencePath.replace(/^\/?illustrations\//, '');
  const absPath = join(ILLUSTRATIONS_DIR, rel);

  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch {
    throw new Error(`Reference image not found on disk: ${referencePath} (resolved to ${absPath})`);
  }

  return `data:image/png;base64,${bytes.toString('base64')}`;
}
