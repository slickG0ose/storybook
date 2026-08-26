import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Byte-budget and provenance guard for the hero-rotation pool frames served from
 * `server/public/hero/`.
 *
 * This is the sibling of `client/src/__tests__/heroAsset.test.ts`, which guards the
 * bundled frame 0. Same job, different delivery path: these files are not compiled into
 * the client bundle, they are served by Express as static assets and fetched after first
 * paint. The source illustrations they are derived from are 1024x1024 PNGs of ~2.2 MB;
 * serving one of those directly is the LCP regression the whole split-budget design
 * exists to prevent, just moved below the fold in time instead of in space.
 *
 * It runs in `cd server && npm test`, so it runs in CI on every PR.
 *
 * See `server/public/hero/README.md` for provenance and the derive command,
 * `server/scripts/derive-hero-frames.sh` for the script that produces these files, and
 * `.code-captain/specs/hero-rotation/spec.md` for why the artifacts are committed rather
 * than derived at build time or on demand.
 */

const HERO_DIR = join(import.meta.dirname, '..', '..', 'public', 'hero');
const MAX_SINGLE_BYTES = 150 * 1024;

/**
 * 400 KB, not the 1 MB the task body first sketched. Repo owner's ruling, 2026-08-26:
 * a cap that permits five frames while two ship is decoration, not a guard -- the
 * bundled-hero budget test earned its keep by sitting close enough to bite. Raise it
 * deliberately, in the same commit that adds the third frame.
 */
const MAX_TOTAL_BYTES = 400 * 1024;

/**
 * `.md` is the README. AVIF is deferred (ADR-014), and the list is written so adding
 * `'.avif'` here is the whole change when it lands -- no test surgery.
 */
const ALLOWED_EXT = ['.webp', '.jpg', '.md'];
const IMAGE_EXT = ['.webp', '.jpg'];
const SOURCE_BOOK_ID = 'b2fa23cf-3156-4b89-83e7-82d98c32c8b7';

interface HeroFile {
  /** Path relative to the hero directory, so a nested file is still identifiable. */
  name: string;
  ext: string;
  bytes: number;
}

/**
 * Walks the directory rather than reading one flat level. Here that is not merely
 * defensive: the served layout is `<book_id>/p<n>-960.webp`, so EVERY artifact lives one
 * level down and a flat read would check nothing at all.
 */
function walk(dir: string, prefix = ''): HeroFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap<HeroFile>(entry => {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return walk(join(dir, entry.name), `${name}/`);
    const dot = entry.name.lastIndexOf('.');
    return [
      {
        name,
        ext: dot > 0 ? entry.name.slice(dot).toLowerCase() : '',
        bytes: statSync(join(dir, entry.name)).size,
      },
    ];
  });
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const describeFile = (f: HeroFile) => `${f.name} (${kb(f.bytes)} / ${f.bytes} bytes)`;

/**
 * EVERY file counts toward the total, README included -- not just the images. Filtering
 * to images would let the budget be gamed by parking bytes in a non-image file, which
 * still ships in the repo and still has to be reviewed.
 */
const files = walk(HERO_DIR);
const images = files.filter(f => IMAGE_EXT.includes(f.ext));

/**
 * Dotfiles are exempt from the extension allowlist only: a macOS `.DS_Store` is local
 * cruft, not a committed artifact, and failing on it would red the suite for whoever
 * opened the folder in Finder. It is still counted in the byte total and still checked
 * by the `.png` rule below, so it cannot be used as a hiding place.
 */
const named = files.filter(f => !f.name.startsWith('.') && !f.name.includes('/.'));

describe('hero pool frame budget', () => {
  it('ships at least one image, and every image is a web-delivery format', () => {
    expect(images.length).toBeGreaterThanOrEqual(1);

    const wrongFormat = named.filter(f => !ALLOWED_EXT.includes(f.ext)).map(describeFile);
    expect(
      wrongFormat,
      `server/public/hero/ may only contain ${ALLOWED_EXT.join(', ')} files. ` +
        `Unexpected: ${wrongFormat.join(', ') || 'none'}`,
    ).toEqual([]);
  });

  it('contains no .png -- a raw source frame must never land here', () => {
    // The single assertion that stops a ~2.2 MB source illustration being copied in
    // instead of derived. `/hero` is a public static mount, so a PNG dropped here is
    // served to every visitor who reaches a rotation. Re-derive with
    // `bash server/scripts/derive-hero-frames.sh`.
    const pngs = files.filter(f => f.ext === '.png').map(describeFile);
    expect(
      pngs,
      'No .png may exist under server/public/hero/ -- the sources are ~2.2 MB and ' +
        `would be served straight to visitors. Offending: ${pngs.join(', ')}`,
    ).toEqual([]);
  });

  it('keeps every single file inside the 150 KB cap', () => {
    const oversize = files.filter(f => f.bytes > MAX_SINGLE_BYTES).map(describeFile);
    expect(
      oversize,
      `Each file under server/public/hero/ must be <= ${kb(MAX_SINGLE_BYTES)} ` +
        `(${MAX_SINGLE_BYTES} bytes). Over cap: ${oversize.join(', ')}`,
    ).toEqual([]);
  });

  it('keeps the whole directory inside the 400 KB total cap', () => {
    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    const breakdown = files.map(describeFile).join('\n  ');
    expect(
      total,
      `server/public/hero/ totals ${kb(total)} (${total} bytes) across ` +
        `${files.length} file(s), over the ${kb(MAX_TOTAL_BYTES)} budget:\n  ${breakdown}`,
    ).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });
});

describe('hero pool frame provenance', () => {
  it('records the source book in README.md so provenance cannot silently rot', () => {
    const readme = files.find(f => f.name === 'README.md');
    expect(readme, 'server/public/hero/README.md is missing').toBeDefined();

    const text = readFileSync(join(HERO_DIR, 'README.md'), 'utf8');
    expect(
      text,
      `README.md must name the source book ID ${SOURCE_BOOK_ID} so the frames can be ` +
        're-derived deliberately if the seeded book is regenerated.',
    ).toContain(SOURCE_BOOK_ID);
  });

  it('names each derived frame after the book page it came from', () => {
    // The resolver in Task 4 looks up `<book_id>/p<page_number>-960.webp` by convention,
    // not by a manifest -- a frame filed under the wrong name is silently invisible
    // rather than loudly broken. This pins the convention itself.
    const misnamed = images
      .filter(f => !/^[^/]+\/p\d+-(480|960)\.webp$/.test(f.name))
      .map(describeFile);
    expect(
      misnamed,
      'Every image under server/public/hero/ must be named ' +
        `<book_id>/p<page_number>-{480,960}.webp -- that path IS the lookup key the pool ` +
        `resolver uses. Misnamed: ${misnamed.join(', ')}`,
    ).toEqual([]);
  });
});
