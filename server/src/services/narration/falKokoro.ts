import { NARRATION_MODEL, type NarrationVoiceId } from '@storybook/shared';
import { NarrationSynthesisError, type NarrationSynthesizer } from './synthesizer';

/**
 * Kokoro-82M text-to-speech on fal (raw fetch — no @fal-ai/client SDK, same
 * posture as `providers/fal.ts`).
 *
 * Endpoint contract, pinned against a real call on 2026-11-08:
 *   - Synchronous run URL:  POST https://fal.run/fal-ai/kokoro/american-english
 *                           (NARRATION_MODEL in @storybook/shared)
 *   - Auth header:          Authorization: Key <FAL_KEY>
 *   - Request body:         { prompt: <text>, voice: <voice id>, speed: 1 }
 *   - Response:             { audio: { url } }
 *   - audio.url serves a 24 kHz mono 16-bit PCM WAV on fal.media.
 *
 * The download leg is the SSRF surface: we fetch a URL the vendor hands us, so
 * only `https:` on `fal.media` / `*.fal.media` is accepted, redirects are
 * refused, the body is capped while streaming, and the bytes must be a RIFF/WAVE
 * file. Each leg (run, download) has its own 60 s timeout covering both the
 * request and the body read.
 *
 * Every failure is a NarrationSynthesisError, and no message ever contains the
 * key (vendor error text is redacted before it is quoted).
 */

export const FAL_KOKORO_TIMEOUT_MS = 60_000;
/** Per-clip cap. One sentence at 24 kHz/16-bit mono is ~48 KB/s, so 5 MB is ~100 s of speech. */
export const FAL_KOKORO_MAX_BYTES = 5 * 1024 * 1024;

interface FalKokoroResponse {
  audio?: { url?: unknown };
}

export interface FalKokoroOptions {
  /** Test seam: per-leg timeout. */
  timeoutMs?: number;
  /** Test seam: download size cap. */
  maxBytes?: number;
}

export class FalKokoroSynthesizer implements NarrationSynthesizer {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(opts: FalKokoroOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? FAL_KOKORO_TIMEOUT_MS;
    this.maxBytes = opts.maxBytes ?? FAL_KOKORO_MAX_BYTES;
  }

  async synthesize(text: string, voiceId: NarrationVoiceId): Promise<Buffer> {
    const apiKey = process.env.FAL_KEY;
    if (!apiKey) throw new NarrationSynthesisError('FAL_KEY is not configured');
    const redact = (s: string) => s.split(apiKey).join('[redacted]');

    // Leg 1: the synchronous run.
    const audioUrl = await this.withTimeout('run', redact, async (signal) => {
      const res = await fetch(`https://fal.run/${NARRATION_MODEL}`, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: text, voice: voiceId, speed: 1 }),
        signal,
      });
      if (!res.ok) {
        const snippet = redact((await res.text().catch(() => '')).slice(0, 300));
        throw new NarrationSynthesisError(
          `fal kokoro run returned ${res.status}${snippet ? `: ${snippet}` : ''}`,
        );
      }
      let data: FalKokoroResponse;
      try {
        data = (await res.json()) as FalKokoroResponse;
      } catch {
        throw new NarrationSynthesisError('fal kokoro run returned non-JSON');
      }
      const url = data?.audio?.url;
      if (typeof url !== 'string' || url === '') {
        throw new NarrationSynthesisError('fal kokoro response had no audio.url');
      }
      return url;
    });

    assertFalMediaUrl(audioUrl);

    // Leg 2: download the WAV. No auth header — the key never leaves for a
    // vendor-supplied URL.
    const bytes = await this.withTimeout('download', redact, async (signal) => {
      const res = await fetch(audioUrl, { signal, redirect: 'error' });
      if (!res.ok) {
        throw new NarrationSynthesisError(`fal kokoro audio download returned ${res.status}`);
      }
      return readCapped(res, this.maxBytes);
    });

    if (!isWav(bytes)) {
      throw new NarrationSynthesisError('fal kokoro audio is not a RIFF/WAVE file');
    }
    return bytes;
  }

  private async withTimeout<T>(
    leg: string,
    redact: (s: string) => string,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fn(controller.signal);
    } catch (err) {
      if (err instanceof NarrationSynthesisError) throw err;
      if (controller.signal.aborted) {
        throw new NarrationSynthesisError(
          `fal kokoro ${leg} timed out after ${Math.round(this.timeoutMs / 1000)}s`,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new NarrationSynthesisError(`fal kokoro ${leg} failed: ${redact(message)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function assertFalMediaUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NarrationSynthesisError('fal kokoro audio.url is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new NarrationSynthesisError(`fal kokoro audio.url must be https (got ${url.protocol})`);
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'fal.media' && !host.endsWith('.fal.media')) {
    throw new NarrationSynthesisError(`fal kokoro audio.url host not allowed: ${host}`);
  }
}

/** Read a response body, failing as soon as it exceeds `maxBytes` (never buffers past the cap). */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new NarrationSynthesisError(`fal kokoro audio exceeds ${maxBytes} bytes`);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new NarrationSynthesisError(`fal kokoro audio exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function isWav(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE'
  );
}

/**
 * Clip duration in ms from the WAV header: data-chunk size / byte rate.
 *
 * Walks the RIFF chunk list rather than assuming a 44-byte header, since
 * encoders may insert LIST/fact chunks. A data size that overruns the buffer
 * (streaming writers emit 0 or 0xFFFFFFFF) is clamped to the bytes present.
 * Throws NarrationSynthesisError if the header is unusable.
 */
export function wavDurationMs(bytes: Buffer): number {
  if (!isWav(bytes)) throw new NarrationSynthesisError('not a RIFF/WAVE file');
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 12 > bytes.length) break;
      byteRate = bytes.readUInt32LE(body + 8);
    } else if (id === 'data') {
      if (byteRate <= 0) break;
      const available = bytes.length - body;
      const dataSize = size === 0 || size > available ? available : size;
      return Math.round((dataSize / byteRate) * 1000);
    }
    // Chunks are word-aligned: odd sizes carry one pad byte.
    offset = body + size + (size % 2);
  }
  throw new NarrationSynthesisError('WAV header has no usable fmt/data chunks');
}
