import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { isUsableApiKey } from '../lib/apiKeys';
import { requireAuth } from '../middleware/requireAuth';
import { spendGate } from '../middleware/spendGate';
import { recordUsage } from '../services/spend';
import { rateLimit } from '../middleware/rateLimit';

const UPLOADS_DIR = join(import.meta.dirname, '../../public/uploads/style-refs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only JPG and PNG files are allowed'));
    }
  },
});

const router = Router();

/**
 * Style-reference upload (#96).
 *
 * This route was previously anonymous and unmetered while making a real Anthropic
 * vision call, which meant any caller who could reach the server could burn tokens —
 * and because it wrote no `UsageLog` row, those tokens were invisible to the global
 * monthly ceiling, the one ceiling nobody is meant to bypass. CORS did not mitigate
 * it: `CORS_ORIGIN` restricts browsers and does nothing to a direct `curl`.
 *
 * Middleware order is load-bearing. `rateLimit` and `spendGate` both read
 * `res.locals.user`, so both must come after `requireAuth` — mounted the other way
 * round they fail closed with a 401 and the route would never work. `upload.single`
 * runs last so a caller who is not allowed through never gets 5MB buffered on their
 * behalf.
 *
 * Rate limiting sits BEFORE the spend gate on purpose. They guard different things:
 * the spend gate bounds what a caller may spend, the rate limit bounds how fast they
 * may ask. A caller who is under quota can still make a hundred multipart uploads a
 * second, each costing a filesystem write and a model call — which is what CodeQL's
 * js/missing-rate-limiting flags on this route, and it is right to. Cheaper to
 * reject first.
 *
 * 10 per 10 minutes: a real author picking a style reference tries a handful of
 * images. This is a ceiling on abuse, not a budget anyone should feel.
 *
 * CodeQL note (alert #23, dismissed as a false positive on 2026-08-29):
 * `js/missing-rate-limiting` will keep pointing at this handler. That query
 * recognises rate limiting by matching a short list of libraries by name —
 * express-rate-limit, express-brute, express-slow-down — so the hand-rolled
 * middleware above is invisible to it no matter how correct it is. The route IS
 * limited; see `middleware/rateLimit.ts` and the three tests in
 * `__tests__/uploads.test.ts` that pin it, including the one asserting the
 * rejection happens before multer writes a file and before Anthropic is called.
 *
 * If the `rateLimit(...)` line above is ever removed, this comment becomes a lie
 * and the dismissal becomes wrong. Delete both together.
 */
router.post(
  '/style-reference',
  requireAuth,
  rateLimit({ max: 10, windowMs: 10 * 60 * 1000, bucket: 'style-reference' }),
  spendGate('style_reference'),
  upload.single('image'),
  async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No image uploaded (field name: image)' });
  }

  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
    const id = randomUUID();
    const filename = `${id}.${ext}`;
    await writeFile(join(UPLOADS_DIR, filename), file.buffer);
    const url = `/uploads/style-refs/${filename}`;

    let descriptor: string | null = null;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    // Describing the style is best-effort: no key means no descriptor, and the
    // upload still succeeds. A placeholder key has to take that same branch —
    // otherwise the copied-`.env.example` case calls Anthropic, 401s, and turns
    // a perfectly good upload into a 500 through the catch below.
    if (isUsableApiKey(apiKey)) {
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: file.mimetype as 'image/jpeg' | 'image/png', data: file.buffer.toString('base64') },
              },
              {
                type: 'text',
                text: 'Describe the art style of this image in 2 sentences. Focus on: medium (watercolor, ink, 3D render, etc.), color palette, line quality, lighting, and overall mood. Do NOT describe the subjects in the image. Return only the description, no preamble.',
              },
            ],
          },
        ],
      });
      const firstBlock = message.content[0];
      if (firstBlock.type === 'text') {
        descriptor = firstBlock.text.trim();
      }

      // Inside the `isUsableApiKey` branch on purpose. Describing the style is
      // best-effort — with no usable key no Anthropic call is made, and charging
      // for a call that never happened would inflate the ceiling that protects the
      // bill. Recorded after the call resolves, matching every other metered path:
      // a failure throws to the catch below and consumes no quota.
      const user = res.locals.user as { id: string };
      await recordUsage(user.id, 'style_reference');
    }

    res.json({ url, descriptor });
  } catch (err: unknown) {
    console.error('Style reference upload error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to process upload. ' + msg });
  }
  },
);

export default router;
