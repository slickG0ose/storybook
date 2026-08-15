// PDF digital export (PS1) — screen-quality renderer.
//
// This file is a deliberate *mirror* of client/src/components/BookSpread.tsx,
// not a reuse of it. BookSpread is a DOM/Tailwind component; @react-pdf/renderer
// drives a different reconciler with its own StyleSheet primitives. The layout
// intent is shared; the implementation is not. When the web spread changes
// shape, change this file too.
//
// Two known visual deltas from the web reader, both deliberate:
//
//   1. Fonts. We render with @react-pdf/renderer's built-in Helvetica rather
//      than the web bundle's `font-display` family. Registering a bundled
//      display font (Atkinson Hyperlegible, OFL) is a one-call swap via
//      Font.register() below; we skip it in PS1 to avoid checking a font
//      binary into the repo before anyone has asked for the fidelity.
//   2. Cover emoji. The standard-14 PDF fonts carry no emoji glyphs, and the
//      only supported workaround (Font.registerEmojiSource) fetches images
//      from a CDN at render time — a network dependency we don't want on this
//      path. The cover instead renders a disc tinted with the book's
//      cover_color. See the "Deferred" note in the spec.
//
// Images are always embedded as *bytes*, never as URLs: handing @react-pdf a
// URL that points back at our own Express server can deadlock the request
// under load (spec §Data flow).

import { readFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  renderToStream,
} from '@react-pdf/renderer';
import type { BookWithPages, Page as BookPage } from '@storybook/shared';

// The renderer only needs the presentational slice of a book. Typing it as a
// Pick (rather than BookWithPages itself) means a raw Prisma row — whose
// created_at is a Date, not the wire shape's ISO string — is assignable
// without a round-trip through JSON.
export type PdfBook = Pick<
  BookWithPages,
  | 'title'
  | 'author'
  | 'description'
  | 'cover_color'
  | 'cover_url'
  | 'is_user_created'
  | 'pages'
>;

// eslint-disable-next-line no-console
console.warn('[pdf] Display font not registered; falling back to Helvetica.');

// ---------------------------------------------------------------------------
// Watermark policy
// ---------------------------------------------------------------------------
// PS1 always watermarks — subscription tiers don't exist yet (spec §Out of
// scope). PS3 swaps the body of this one function to make the band
// tier-aware; the <Page> templates below never need to change.
export function watermarkFor(_book: PdfBook): string | null {
  return 'Created with StoryBook Storefront · storybook.example.com';
}

// ---------------------------------------------------------------------------
// Text sanitising
// ---------------------------------------------------------------------------
// Helvetica encodes WinAnsi. Anything outside it (emoji, CJK) renders as a
// missing glyph, so strip it here rather than shipping tofu into a children's
// book. Smart quotes, dashes and ellipses survive — they're all in WinAnsi.
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function sanitizeForPdf(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    const printableAscii = cp >= 0x20 && cp <= 0x7e;
    const latin1Supplement = cp >= 0xa0 && cp <= 0xff;
    const newline = cp === 0x0a || cp === 0x0d;
    if (printableAscii || latin1Supplement || newline || WINANSI_EXTRAS.has(cp)) {
      out += ch;
    }
  }
  return out;
}

// `#7c3aed` + 0.12 → `rgba(124, 58, 237, 0.12)`. Mirrors BookSpread's
// `backgroundColor: book.cover_color + '20'` trick without relying on the PDF
// colour parser accepting 8-digit hex.
function tint(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return `rgba(124, 58, 237, ${alpha})`;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------
const PUBLIC_DIR = resolve(join(import.meta.dirname, '../../public'));
const REMOTE_TIMEOUT_MS = 10_000;

type EmbeddedImage = { data: Buffer; format: 'png' | 'jpg' };

function detectFormat(buf: Buffer): 'png' | 'jpg' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

// Resolves a stored illustration/cover URL to raw bytes. Returns null on any
// failure — a missing or unreadable image degrades to the placeholder panel
// rather than failing the whole download (spec §Risks).
async function loadImage(url: string): Promise<EmbeddedImage | null> {
  try {
    let buf: Buffer;
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`remote image ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      const abs = resolve(join(PUBLIC_DIR, url.replace(/^\/+/, '')));
      // Refuse anything that escapes public/ — the URL comes off a DB row.
      if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + sep)) {
        throw new Error(`image path escapes public dir: ${url}`);
      }
      buf = await readFile(abs);
    }
    const format = detectFormat(buf);
    if (!format) throw new Error('unsupported image format (want PNG or JPEG)');
    return { data: buf, format };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pdf] skipping image ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Styles — amber-cream paper, dark text (mirrors BookSpread's palette)
// ---------------------------------------------------------------------------
const PAPER = '#FFFBEB'; // amber-50
const FRAME = '#FEF3C7'; // amber-100
const FRAME_BORDER = '#FDE68A'; // amber-200
const CANVAS = '#FFFFFF';
const INK = '#1F2937'; // gray-800
const INK_SOFT = '#374151'; // gray-700
const MUTED = '#6B7280'; // gray-500
const AMBER_INK = '#B45309'; // amber-700

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAPER,
    paddingHorizontal: 26,
    paddingTop: 26,
    paddingBottom: 34,
    fontFamily: 'Helvetica',
  },
  frame: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: FRAME,
    borderRadius: 12,
    border: `1pt solid ${FRAME_BORDER}`,
    padding: 8,
  },
  half: {
    flex: 1,
    backgroundColor: CANVAS,
    borderRadius: 8,
    padding: 22,
    flexDirection: 'column',
  },
  spine: {
    width: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    padding: 18,
  },
  coverDisc: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 18,
  },
  coverImage: {
    maxHeight: 210,
    marginBottom: 18,
    objectFit: 'contain',
    borderRadius: 8,
  },
  coverTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 24,
    color: INK,
    textAlign: 'center',
    marginBottom: 8,
  },
  coverAuthor: {
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
  },
  coverBlurb: {
    fontSize: 11,
    color: AMBER_INK,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  illustration: {
    flex: 1,
    borderRadius: 8,
    objectFit: 'cover',
  },
  placeholder: {
    flex: 1,
    borderRadius: 8,
    border: `1.5pt dashed ${FRAME_BORDER}`,
    backgroundColor: PAPER,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  placeholderTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: AMBER_INK,
    marginBottom: 8,
    textAlign: 'center',
  },
  placeholderBody: {
    fontSize: 9,
    color: AMBER_INK,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  storyText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 1.7,
    color: INK_SOFT,
  },
  pageNumber: {
    fontSize: 9,
    color: AMBER_INK,
    fontStyle: 'italic',
    textAlign: 'right',
    marginTop: 12,
  },
  endTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 26,
    color: INK_SOFT,
    marginBottom: 8,
    textAlign: 'center',
  },
  endSub: {
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
  },
  endBlurb: {
    fontSize: 11,
    color: MUTED,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  watermark: {
    position: 'absolute',
    bottom: 12,
    left: 26,
    right: 26,
  },
  watermarkText: {
    fontSize: 7.5,
    color: MUTED,
    textAlign: 'center',
  },
});

// ---------------------------------------------------------------------------
// Spread templates
// ---------------------------------------------------------------------------
function CoverSpread({ book, cover }: { book: PdfBook; cover: EmbeddedImage | null }) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.frame}>
        <View style={styles.half}>
          <View style={styles.centered}>
            {book.is_user_created ? (
              <Text style={styles.coverBlurb}>A story written just for you</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.spine} />
        <View style={styles.half}>
          <View style={[styles.coverPanel, { backgroundColor: tint(book.cover_color, 0.12) }]}>
            {cover ? (
              <Image style={styles.coverImage} src={cover} />
            ) : (
              <View style={[styles.coverDisc, { backgroundColor: tint(book.cover_color, 0.85) }]} />
            )}
            <Text style={styles.coverTitle}>{sanitizeForPdf(book.title)}</Text>
            <Text style={styles.coverAuthor}>by {sanitizeForPdf(book.author)}</Text>
          </View>
        </View>
      </View>
    </Page>
  );
}

function StorySpread({
  page,
  illustration,
  watermark,
}: {
  page: BookPage;
  illustration: EmbeddedImage | null;
  watermark: string | null;
}) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.frame}>
        <View style={styles.half}>
          {illustration ? (
            <Image style={styles.illustration} src={illustration} />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderTitle}>Illustration coming soon</Text>
              <Text style={styles.placeholderBody}>
                {sanitizeForPdf(page.illustration_description)}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.spine} />
        <View style={styles.half}>
          <Text style={styles.storyText}>{sanitizeForPdf(page.text)}</Text>
          <Text style={styles.pageNumber}>— page {page.page_number}</Text>
        </View>
      </View>
      {watermark ? (
        <View style={styles.watermark}>
          <Text style={styles.watermarkText}>{sanitizeForPdf(watermark)}</Text>
        </View>
      ) : null}
    </Page>
  );
}

function EndSpread({ book }: { book: PdfBook }) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.frame}>
        <View style={styles.half}>
          <View style={styles.centered}>
            <Text style={styles.endTitle}>The End</Text>
            <Text style={styles.endSub}>Hope you enjoyed the story.</Text>
          </View>
        </View>
        <View style={styles.spine} />
        <View style={styles.half}>
          <View style={styles.centered}>
            <Text style={styles.endBlurb}>{sanitizeForPdf(book.description)}</Text>
          </View>
        </View>
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
/**
 * Renders a book to a screen-quality PDF stream: cover spread, one spread per
 * story page, end spread. Never rejects on missing or unreadable images — they
 * degrade to a placeholder panel.
 *
 * Every image is fetched to a Buffer *before* the reconciler runs, because
 * @react-pdf's JSX tree has to be synchronous.
 */
export async function renderBookPdf(book: PdfBook): Promise<NodeJS.ReadableStream> {
  const pages = [...(book.pages ?? [])].sort((a, b) => a.page_number - b.page_number);

  const [cover, illustrations] = await Promise.all([
    book.cover_url ? loadImage(book.cover_url) : Promise.resolve(null),
    Promise.all(pages.map(p => (p.illustration_url ? loadImage(p.illustration_url) : null))),
  ]);

  const watermark = watermarkFor(book);

  return renderToStream(
    <Document title={sanitizeForPdf(book.title)} author={sanitizeForPdf(book.author)}>
      <CoverSpread book={book} cover={cover} />
      {pages.map((page, i) => (
        <StorySpread
          key={page.id}
          page={page}
          illustration={illustrations[i] ?? null}
          watermark={watermark}
        />
      ))}
      <EndSpread book={book} />
    </Document>,
  );
}
