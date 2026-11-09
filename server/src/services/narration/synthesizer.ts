import type { NarrationVoiceId } from '@storybook/shared';
import { isUsableApiKey } from '../../lib/apiKeys';
import { resolveBackendName } from '../storage';
import { FalKokoroSynthesizer } from './falKokoro';

/**
 * The narration synthesizer seam (generated-narration spec, design question 8).
 *
 * Owns ONLY the text -> audio-bytes call. Caching, metering, splitting, and
 * storage live in the cache-or-generate service, which depends on this
 * interface so its tests can `vi.mock` this module with a call-counting fake.
 * No test anywhere makes a live synthesis call.
 */
export interface NarrationSynthesizer {
  /** Returns WAV bytes for exactly `text`, at speed 1. Throws NarrationSynthesisError on any failure. */
  synthesize(text: string, voiceId: NarrationVoiceId): Promise<Buffer>;
}

/**
 * Every adapter failure — HTTP error, malformed response, bad download host,
 * oversize or non-WAV bytes, timeout — surfaces as this one type, so the
 * service maps it to `upstream-failed` without inspecting vendor detail.
 * Messages never carry the API key.
 */
export class NarrationSynthesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NarrationSynthesisError';
  }
}

/** The one real implementation: Kokoro-82M on fal (raw fetch, no SDK). */
export function getNarrationSynthesizer(): NarrationSynthesizer {
  return new FalKokoroSynthesizer();
}

/**
 * Can this server generate narration right now?
 *
 * Needs a usable FAL_KEY (template filler doesn't count — see `lib/apiKeys.ts`)
 * AND, in production, durable storage. Generated clips are cached forever and
 * billed once; on Render's ephemeral local disk they would vanish on the next
 * spin-down and get re-bought, so production without R2 reports unavailable
 * and readers stay on device voices.
 *
 * An invalid STORAGE_BACKEND makes `resolveBackendName` throw; that is treated
 * as "not configured" rather than crashing a public voices endpoint.
 */
export function isNarrationConfigured(): boolean {
  if (!isUsableApiKey(process.env.FAL_KEY)) return false;
  if (process.env.NODE_ENV !== 'production') return true;
  try {
    return resolveBackendName() === 'r2';
  } catch {
    return false;
  }
}
