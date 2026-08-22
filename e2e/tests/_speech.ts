import type { Page } from '@playwright/test';

/**
 * A deterministic fake `window.speechSynthesis`, injected before any app script runs.
 *
 * **Why this exists.** Headless Chromium has no speech engine. `window.speechSynthesis` is
 * present, but `getVoices()` returns `[]` (measured) and `speak()` produces no reliable
 * `start`/`end` events — so without injection the player resolves to
 * "Read-aloud isn't available in this browser." after the voice-load timeout, and every
 * narration assertion in this suite would be vacuous.
 *
 * **What these specs therefore prove, stated plainly: the state machine and the UI, not
 * that anything is audible.** Audibility is the one manual listen recorded in the spec's
 * autonomy ledger (`.code-captain/specs/read-aloud/spec.md`, §"Autonomy ledger"). No
 * assertion written against this fake can tell you whether a voice said the words.
 *
 * Both installers must be called **before** `page.goto`. `addInitScript` runs once per
 * navigation, which also means the fake survives the reloads `forEachTheme` performs.
 *
 * The fake is deliberately dumb — a FIFO queue advanced by wall-clock timers, no clever
 * behaviour — and mirrors `client/src/test/fakeSpeech.ts` so the unit and e2e layers share
 * one model of the API. The one behaviour it goes out of its way to reproduce is Chrome's:
 * `cancel()` still fires `end` on the in-flight utterance, asynchronously, after the caller
 * has moved on. That is the event the `runId` guard exists to ignore.
 */

export interface FakeSpeechVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

export interface FakeSpeechOptions {
  voices?: FakeSpeechVoice[];
  /** Emit word-granularity `boundary` events. Default false — matches Safari/Android. */
  emitWordBoundary?: boolean;
  /**
   * Wall-clock ms per utterance. Keep it small — the book is read in real time — but not so
   * small that a sentence has come and gone before an assertion can observe it. Callers that
   * assert on a *sequence* of highlights pass a larger value on purpose.
   */
  chunkMs?: number;
}

const DEFAULT_VOICES: FakeSpeechVoice[] = [
  { voiceURI: 'urn:fake:samantha', name: 'Samantha', lang: 'en-US', localService: true, default: true },
  { voiceURI: 'urn:fake:daniel', name: 'Daniel', lang: 'en-GB', localService: false },
];

/** Installs a deterministic `window.speechSynthesis` via `addInitScript`, before app scripts run. */
export async function installFakeSpeech(page: Page, opts: FakeSpeechOptions = {}): Promise<void> {
  const options = {
    voices: opts.voices ?? DEFAULT_VOICES,
    emitWordBoundary: opts.emitWordBoundary ?? false,
    chunkMs: opts.chunkMs ?? 250,
  };

  await page.addInitScript((config: Required<FakeSpeechOptions>) => {
    class FakeUtterance extends EventTarget {
      text: string;
      lang = '';
      voice: unknown = null;
      rate = 1;
      pitch = 1;
      volume = 1;
      onstart: ((event: unknown) => void) | null = null;
      onend: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onboundary: ((event: unknown) => void) | null = null;
      onpause: ((event: unknown) => void) | null = null;
      onresume: ((event: unknown) => void) | null = null;
      onmark: ((event: unknown) => void) | null = null;

      constructor(text = '') {
        super();
        this.text = text;
      }
    }

    const event = (
      utterance: FakeUtterance,
      fields: { name?: string; charIndex?: number; charLength?: number; error?: string } = {},
    ): unknown => ({
      utterance,
      charIndex: 0,
      charLength: 0,
      elapsedTime: 0,
      name: '',
      ...fields,
    });

    /** Word start offsets and lengths, for simulated `boundary` events. */
    const wordOffsets = (text: string): { index: number; length: number }[] => {
      const words: { index: number; length: number }[] = [];
      const pattern = /\S+/g;
      let match = pattern.exec(text);
      while (match !== null) {
        words.push({ index: match.index, length: match[0].length });
        match = pattern.exec(text);
      }
      return words;
    };

    class FakeSpeechSynthesis extends EventTarget {
      paused = false;
      pending = false;
      speaking = false;
      onvoiceschanged: ((event: Event) => void) | null = null;

      private readonly queue: FakeUtterance[] = [];
      private timers = new Set<number>();
      private current: FakeUtterance | null = null;

      getVoices(): unknown[] {
        return config.voices.map((spec) => ({
          voiceURI: spec.voiceURI,
          name: spec.name,
          lang: spec.lang,
          localService: spec.localService,
          default: spec.default ?? false,
        }));
      }

      speak(utterance: FakeUtterance): void {
        this.queue.push(utterance);
        this.pump();
        this.pending = this.queue.length > 0;
      }

      cancel(): void {
        const interrupted = this.current;
        this.clearTimers();
        this.queue.length = 0;
        this.current = null;
        this.speaking = false;
        this.pending = false;
        this.paused = false;

        // Chrome fires `end` on the in-flight utterance asynchronously, after the caller has
        // already turned the page. Reproducing that is the whole point of this fake.
        if (interrupted) {
          window.setTimeout(() => interrupted.onend?.(event(interrupted)), 0);
        }
      }

      pause(): void {
        if (!this.speaking) return;
        this.paused = true;
        this.clearTimers();
      }

      resume(): void {
        if (!this.paused) return;
        this.paused = false;
        const speaking = this.current;
        if (speaking) this.later(() => this.finish(speaking), config.chunkMs);
      }

      private later(fn: () => void, ms: number): void {
        const id = window.setTimeout(() => {
          this.timers.delete(id);
          fn();
        }, ms);
        this.timers.add(id);
      }

      private clearTimers(): void {
        for (const id of this.timers) window.clearTimeout(id);
        this.timers.clear();
      }

      private pump(): void {
        if (this.current || this.queue.length === 0) return;
        const next = this.queue.shift();
        if (!next) return;
        this.current = next;
        this.later(() => this.start(next), 0);
      }

      private start(utterance: FakeUtterance): void {
        this.speaking = true;
        this.pending = this.queue.length > 0;
        utterance.onstart?.(event(utterance));

        if (config.emitWordBoundary) {
          for (const word of wordOffsets(utterance.text)) {
            const at = Math.round(
              (word.index / Math.max(1, utterance.text.length)) * config.chunkMs,
            );
            this.later(
              () =>
                utterance.onboundary?.(
                  event(utterance, { name: 'word', charIndex: word.index, charLength: word.length }),
                ),
              at,
            );
          }
        }

        this.later(() => this.finish(utterance), config.chunkMs);
      }

      private finish(utterance: FakeUtterance): void {
        if (this.current !== utterance) return;
        this.current = null;
        this.speaking = false;
        utterance.onend?.(event(utterance));
        this.pump();
      }
    }

    Object.defineProperty(window, 'speechSynthesis', {
      value: new FakeSpeechSynthesis(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true,
      writable: true,
    });
  }, options);
}

/**
 * Removes `window.speechSynthesis` entirely — the `'unavailable'` path.
 *
 * The property is deleted from the prototype chain as well as the instance: in Chromium it
 * lives on `Window.prototype`, so a bare `delete window.speechSynthesis` leaves
 * `'speechSynthesis' in window` true and the feature would still look available.
 */
export async function installNoSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const targets: object[] = [window, Object.getPrototypeOf(window) as object];
    for (const name of ['speechSynthesis', 'SpeechSynthesisUtterance']) {
      for (const target of targets) {
        if (Object.prototype.hasOwnProperty.call(target, name)) {
          Reflect.deleteProperty(target, name);
        }
      }
    }
  });
}
