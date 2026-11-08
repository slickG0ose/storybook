import type { Page } from '@playwright/test';

/**
 * A deterministic fake for `HTMLMediaElement.prototype.play` / `pause`, injected before any
 * app script runs. The `<audio>` counterpart of `_speech.ts`.
 *
 * **Why this exists.** The generated narration provider
 * (`client/src/lib/narration/generatedProvider.ts`) drives one `<audio>` element: clip *i*
 * is chunk *i*, `playing` means the chunk started and `ended` means it finished. Headless
 * Chromium's real media pipeline makes both of those timing-dependent (autoplay policy,
 * decode latency, a 100 ms clip that can be over before an assertion looks), so without a
 * fake the sentence-highlight assertions would race.
 *
 * **What specs built on this prove, stated plainly: the state machine and the UI, not that
 * anything is audible.** The real-key generation and listen are PR-body obligations
 * (generated-narration spec, §Constraints "AI path honesty"), never an e2e claim.
 *
 * What is real and what is faked:
 * - **Real:** setting `src`. The browser still requests the clip URL (so a spec's
 *   `page.route` for the WAV fixture is exercised) and still fires a real `error` event if
 *   the fixture does not decode. That keeps a broken fixture from passing silently.
 * - **Faked:** `play()` resolves at once and, after `clipMs` of wall clock, dispatches
 *   `playing` then `ended` — but only if `src` has not changed in the meantime. That guard
 *   is what makes the provider's synchronous silent-WAV prime harmless: its timers belong to
 *   a source that has already been replaced by the first clip. `pause()` clears the timers;
 *   the next `play()` starts the clip's full `clipMs` again (deliberately dumb — no
 *   remaining-time bookkeeping).
 *
 * Call before `page.goto`. `addInitScript` runs once per navigation, so the fake survives
 * the reloads `forEachTheme` performs.
 */

export interface FakeMediaOptions {
  /**
   * Wall-clock ms between `play()` and `ended`. Small, because the book is read in real
   * time, but large enough that a highlight can be observed before the next one replaces it.
   */
  clipMs?: number;
}

export async function installFakeMedia(page: Page, opts: FakeMediaOptions = {}): Promise<void> {
  const options = { clipMs: opts.clipMs ?? 400 };

  await page.addInitScript((config: Required<FakeMediaOptions>) => {
    const proto = HTMLMediaElement.prototype;
    const timers = new WeakMap<HTMLMediaElement, number[]>();

    const clear = (el: HTMLMediaElement): void => {
      for (const id of timers.get(el) ?? []) window.clearTimeout(id);
      timers.set(el, []);
    };

    const later = (el: HTMLMediaElement, ms: number, fn: () => void): void => {
      const id = window.setTimeout(fn, ms);
      timers.set(el, [...(timers.get(el) ?? []), id]);
    };

    Object.defineProperty(proto, 'play', {
      configurable: true,
      writable: true,
      value: function play(this: HTMLMediaElement): Promise<void> {
        clear(this);
        const source = this.src;
        const live = (): boolean => this.src === source;
        later(this, 0, () => {
          if (live()) this.dispatchEvent(new Event('playing'));
        });
        later(this, config.clipMs, () => {
          if (live()) this.dispatchEvent(new Event('ended'));
        });
        return Promise.resolve();
      },
    });

    Object.defineProperty(proto, 'pause', {
      configurable: true,
      writable: true,
      value: function pause(this: HTMLMediaElement): void {
        clear(this);
      },
    });
  }, options);
}
