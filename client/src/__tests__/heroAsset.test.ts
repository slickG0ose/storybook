import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Byte-budget and provenance guard for the Home hero art.
 *
 * The source illustrations this asset is derived from are 1024x1024 PNGs of ~2.2 MB.
 * Dropping one of those into the bundle would land it above the fold and destroy LCP --
 * the exact metric the hero redesign exists to protect. This suite is the mechanical
 * stop: it runs in `cd client && npm test`, so it runs in CI on every PR.
 *
 * It reads from disk with node:fs. The Vitest environment is jsdom, but the runtime is
 * still Node, so the filesystem is available.
 *
 * See `client/src/assets/hero/README.md` for the derivation command and the numbers, and
 * `.code-captain/specs/hero-visual/spec.md` for why the artifact is committed rather
 * than produced by a build step.
 */

/**
 * Deliberately NOT `new URL('../assets/hero/', import.meta.url)`. Vite's
 * `asset-import-meta-url` transform rewrites that exact literal pattern into a
 * served-asset URL -- under Vitest it evaluates to `http://localhost:3000/src/assets/hero`,
 * and `fileURLToPath` then throws "The URL must be of scheme file". Resolving the
 * module's own path first sidesteps the transform.
 */
const HERO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'hero')
const MAX_SINGLE_BYTES = 150 * 1024
const MAX_TOTAL_BYTES = 200 * 1024
const ALLOWED_EXT = ['.webp', '.jpg', '.md'] // .md is the README
const IMAGE_EXT = ['.webp', '.jpg']
const SOURCE_BOOK_ID = 'b2fa23cf-3156-4b89-83e7-82d98c32c8b7'

interface HeroFile {
  /** Path relative to the hero directory, so a nested file is still identifiable. */
  name: string
  ext: string
  bytes: number
}

/**
 * Walks the directory rather than reading one flat level: a subdirectory would otherwise
 * be a hole in both the byte budget and the no-PNG rule.
 */
function walk(dir: string, prefix = ''): HeroFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap<HeroFile>(entry => {
    const name = `${prefix}${entry.name}`
    if (entry.isDirectory()) return walk(join(dir, entry.name), `${name}/`)
    const dot = entry.name.lastIndexOf('.')
    return [
      {
        name,
        ext: dot > 0 ? entry.name.slice(dot).toLowerCase() : '',
        bytes: statSync(join(dir, entry.name)).size,
      },
    ]
  })
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
const describeFile = (f: HeroFile) => `${f.name} (${kb(f.bytes)} / ${f.bytes} bytes)`

/**
 * EVERY file counts toward the total, README included -- not just the images. Filtering
 * to images would let the budget be gamed by parking bytes in a non-image file, which
 * still ships in the repo and still has to be reviewed.
 */
const files = walk(HERO_DIR)
const images = files.filter(f => IMAGE_EXT.includes(f.ext))

/**
 * Dotfiles are exempt from the extension allowlist only: a macOS `.DS_Store` is local
 * cruft, not a committed artifact, and failing on it would red the suite for whoever
 * opened the folder in Finder. It is still counted in the byte total and still checked
 * by the `.png` rule below, so it cannot be used as a hiding place.
 */
const named = files.filter(f => !f.name.startsWith('.') && !f.name.includes('/.'))

describe('hero asset budget', () => {
  it('ships at least one image, and every image is a web-delivery format', () => {
    expect(images.length).toBeGreaterThanOrEqual(1)

    const wrongFormat = named.filter(f => !ALLOWED_EXT.includes(f.ext)).map(describeFile)
    expect(
      wrongFormat,
      `client/src/assets/hero/ may only contain ${ALLOWED_EXT.join(', ')} files. ` +
        `Unexpected: ${wrongFormat.join(', ') || 'none'}`,
    ).toEqual([])
  })

  it('contains no .png -- a raw source frame must never land here', () => {
    // The single assertion that stops a ~2.2 MB source illustration from being copied in
    // instead of derived. Re-derive with the command in this directory's README.
    const pngs = files.filter(f => f.ext === '.png').map(describeFile)
    expect(
      pngs,
      'No .png may exist under client/src/assets/hero/ -- the sources are ~2.2 MB and ' +
        `would wreck LCP above the fold. Offending: ${pngs.join(', ')}`,
    ).toEqual([])
  })

  it('keeps every single file inside the 150 KB cap', () => {
    const oversize = files.filter(f => f.bytes > MAX_SINGLE_BYTES).map(describeFile)
    expect(
      oversize,
      `Each file under client/src/assets/hero/ must be <= ${kb(MAX_SINGLE_BYTES)} ` +
        `(${MAX_SINGLE_BYTES} bytes). Over cap: ${oversize.join(', ')}`,
    ).toEqual([])
  })

  it('keeps the whole directory inside the 200 KB total cap', () => {
    const total = files.reduce((sum, f) => sum + f.bytes, 0)
    const breakdown = files.map(describeFile).join('\n  ')
    expect(
      total,
      `client/src/assets/hero/ totals ${kb(total)} (${total} bytes) across ` +
        `${files.length} file(s), over the ${kb(MAX_TOTAL_BYTES)} budget:\n  ${breakdown}`,
    ).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })
})

describe('hero asset provenance', () => {
  it('records the source book in README.md so provenance cannot silently rot', () => {
    const readme = files.find(f => f.name === 'README.md')
    expect(readme, 'client/src/assets/hero/README.md is missing').toBeDefined()

    const text = readFileSync(join(HERO_DIR, 'README.md'), 'utf8')
    expect(
      text,
      `README.md must name the source book ID ${SOURCE_BOOK_ID} so the asset can be ` +
        're-derived deliberately if the seeded book is regenerated.',
    ).toContain(SOURCE_BOOK_ID)
  })
})
