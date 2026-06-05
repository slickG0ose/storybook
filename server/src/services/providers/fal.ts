import type { ImageGenerator } from '../illustrations';

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
 * (2026-06-05, https://fal.ai/models/fal-ai/flux-pro/v1.1/api):
 *   - Synchronous run URL:  POST https://fal.run/<model-id>
 *   - Auth header:          Authorization: Key <FAL_KEY>   (Fal convention)
 *   - Request body fields:  { prompt, image_size: 'square_hd', num_images: 1,
 *                             output_format: 'png' }
 *     image_size 'square_hd' is the square preset (parity with OpenAI's
 *     1024x1024); output_format 'png' matches the OpenAI path's PNG bytes.
 *   - Response shape:       { images: [{ url, content_type, width, height }], ... }
 *     We parse images[0].url, then fetch that URL and return the bytes.
 */
export class FalImageGenerator implements ImageGenerator {
  readonly name = 'fal' as const;

  async generate(prompt: string): Promise<Buffer> {
    const apiKey = process.env.FAL_KEY!;
    const modelId = process.env.FAL_IMAGE_MODEL || 'fal-ai/flux-pro/v1.1';
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
        body: JSON.stringify({
          prompt,
          image_size: 'square_hd',
          num_images: 1,
          output_format: 'png',
        }),
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
