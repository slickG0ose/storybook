import { writeFile, mkdir, readdir, stat } from 'fs/promises';
import { join } from 'path';
import prisma from '../db/prisma';
import type { Character } from '../types';
import { FalImageGenerator } from './providers/fal';

const ILLUSTRATIONS_DIR = join(import.meta.dirname, '../../public/illustrations');
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

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

// Provider abstraction for image generation. Implementations own only the
// network call: they take a fully-assembled prompt and return raw image
// bytes. Versioning, on-disk writes, and the illustrationVersion Prisma row
// stay in the public service functions (generateIllustration/generateCover),
// so persistence is provider-agnostic. Phase 1 ships OpenAI; Fal is added in
// a later task.
export interface ImageGenerator {
  readonly name: 'openai' | 'fal';
  generate(prompt: string): Promise<Buffer>;
}

// Cap a single image-generation request at 120s. Without this, a hung
// response from OpenAI (or an intermediary like a corporate proxy that
// drops the connection silently) leaves the route handler awaiting forever
// and the client sees nothing actionable. 120s is a generous upper bound —
// gpt-image-1 typically responds in 10-30s.
const OPENAI_IMAGE_TIMEOUT_MS = 120_000;

class OpenAIImageGenerator implements ImageGenerator {
  readonly name = 'openai' as const;

  async generate(prompt: string): Promise<Buffer> {
    const apiKey = process.env.OPENAI_API_KEY!;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_IMAGE_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt,
          n: 1,
          size: '1024x1024',
        }),
        signal: controller.signal,
      });
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
      console.error(`OpenAI image error (${IMAGE_MODEL}):`, err);
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

// Provider selection, resolved once per call from the environment. The
// selector env var is IMAGE_PROVIDER and defaults to 'fal' (ADR decision 2).
// 'openai' resolves to OpenAIImageGenerator; 'fal' (and the default) resolves
// to FalImageGenerator (raw fetch to Flux Pro 1.1, see providers/fal.ts).
export function getImageGenerator(): ImageGenerator {
  const provider = process.env.IMAGE_PROVIDER || 'fal';
  switch (provider) {
    case 'openai':
      return new OpenAIImageGenerator();
    case 'fal':
    default:
      return new FalImageGenerator();
  }
}

// Provider-aware replacement for the literal OPENAI_API_KEY route/service
// gates. Returns true iff the SELECTED provider's key env var is present:
//   provider 'openai' -> !!process.env.OPENAI_API_KEY
//   provider 'fal'    -> !!process.env.FAL_KEY
export function isImageGenConfigured(): boolean {
  const provider = process.env.IMAGE_PROVIDER || 'fal';
  if (provider === 'openai') {
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
): Promise<string | null> {
  if (!isImageGenConfigured()) return null;

  const style = styleDescriptor?.trim() || 'Whimsical, colorful, warm, suitable for young children';
  const castPrefix = formatCastPrefix(characters);
  let prompt = `${castPrefix}Children's book illustration, ${description}. ${style}. No text or words in the image.`;
  if (feedback) {
    prompt += ` Revision instructions: ${feedback}`;
  }

  const buffer = await getImageGenerator().generate(prompt);

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

export async function generateCover(
  bookId: string,
  title: string,
  description: string,
  styleDescriptor?: string | null,
  characters?: Character[],
): Promise<string | null> {
  if (!isImageGenConfigured()) return null;

  const style = styleDescriptor?.trim() || 'Whimsical, colorful, warm, suitable for young children';
  const castPrefix = formatCastPrefix(characters);
  const prompt = `${castPrefix}Children's book cover illustration for a story titled "${title}". Scene: ${description}. ${style}. Composition suitable for a book cover (centered subject, room at top for title). No text or words in the image.`;

  const buffer = await getImageGenerator().generate(prompt);

  const dir = join(ILLUSTRATIONS_DIR, bookId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'cover.png'), buffer);

  return `/illustrations/${bookId}/cover.png`;
}
