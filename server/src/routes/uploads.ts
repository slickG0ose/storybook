import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { isUsableApiKey } from '../lib/apiKeys';

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

router.post('/style-reference', upload.single('image'), async (req: Request, res: Response) => {
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
    }

    res.json({ url, descriptor });
  } catch (err: unknown) {
    console.error('Style reference upload error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to process upload. ' + msg });
  }
});

export default router;
