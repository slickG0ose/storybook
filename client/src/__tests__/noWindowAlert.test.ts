import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `window.alert()` is not an error surface (#115).
 *
 * It blocks the page, it cannot be themed, it ignores dark mode, and it reads as unfinished
 * software. Every failure the client shows now goes through `useToast().showError(...)` and
 * renders in `ErrorToastHost` — see `.code-captain/specs/error-toast-host/spec.md`.
 *
 * This is issue #115's "Done when" turned into a check that runs on every PR, rather than a
 * grep someone remembers to run. It reads the real source tree with `node:fs`: the Vitest
 * environment is jsdom, but the runtime is Node, so the filesystem is available.
 *
 * Deliberately NOT `new URL('..', import.meta.url)` — Vite's `asset-import-meta-url`
 * transform rewrites that literal pattern into a served-asset URL, and `fileURLToPath` then
 * throws "The URL must be of scheme file". `heroAsset.test.ts` is the worked example.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Test files may name the thing they are forbidding — this file is the proof. */
const SKIPPED_SEGMENT = '__tests__'
const EXTENSIONS = ['.ts', '.tsx']

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === SKIPPED_SEGMENT || entry === 'node_modules') continue
      sourceFiles(full, found)
      continue
    }
    if (EXTENSIONS.some(ext => entry.endsWith(ext))) found.push(full)
  }
  return found
}

/**
 * Comments are stripped before scanning, so a file may *explain* why `window.alert()` is
 * gone (`ToastContext.tsx` does) without tripping the check. The stripper is crude — a `//`
 * inside a string literal takes the rest of that line with it — which can only ever cause a
 * false negative on a line that both contains a URL and calls alert after it. Worth it: the
 * alternative is a check nobody can document around.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** `window.alert(...)`, `globalThis.alert(...)`, and a bare `alert(...)` call. */
const ALERT_CALL = /(?:^|[^.\w$])(?:(?:window|globalThis|self)\s*\.\s*)?alert\s*\(/

describe('no window.alert in client source (#115)', () => {
  const files = sourceFiles(SRC)

  it('finds the source tree it is supposed to be guarding', () => {
    // A broken path would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(20)
    expect(files.some(f => f.endsWith('pages/Admin.tsx'))).toBe(true)
  })

  it('has no alert() call in any non-test file', () => {
    const offenders: string[] = []

    for (const file of files) {
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
      lines.forEach((line, i) => {
        if (ALERT_CALL.test(line)) {
          offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`)
        }
      })
    }

    // Named by path and line: a bare boolean tells the next contributor nothing.
    expect(
      offenders,
      `window.alert() is not an error surface — use useToast().showError(...) instead ` +
        `(#115, .code-captain/specs/error-toast-host/spec.md). Offending call sites:\n` +
        offenders.map(o => `  ${o}`).join('\n'),
    ).toEqual([])
  })
})
