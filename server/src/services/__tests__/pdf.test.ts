import { describe, it, expect, afterAll } from 'vitest';
import { rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import prisma from '../../db/prisma';
import { renderBookPdf, watermarkFor, sanitizeForPdf, type PdfBook } from '../pdf';

const TEST_BOOK_ID = 'luna-star-garden';
const ILLUSTRATIONS_DIR = join(import.meta.dirname, '../../../public/illustrations', TEST_BOOK_ID);

// A 1x1 transparent PNG — the smallest bytes that survive format sniffing and
// the @react-pdf image embedder.
const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// The seeded book, read straight from the DB so the fixture tracks the real
// row shape rather than a hand-written stand-in that can drift.
async function seededBook(): Promise<PdfBook> {
  const book = await prisma.book.findFirstOrThrow({
    where: { id: TEST_BOOK_ID },
    include: { pages: { orderBy: { page_number: 'asc' } } },
  });
  return book;
}

describe('pdf renderer service', () => {
  afterAll(async () => {
    await rm(ILLUSTRATIONS_DIR, { recursive: true, force: true });
  });

  describe('watermarkFor', () => {
    it('returns the MVP watermark string for any book', async () => {
      const book = await seededBook();
      expect(watermarkFor(book)).toBe(
        'Created with StoryBook Storefront · storybook.example.com',
      );
    });
  });

  describe('sanitizeForPdf', () => {
    it('keeps WinAnsi-encodable text and strips glyphs Helvetica cannot render', () => {
      expect(sanitizeForPdf('Luna — “the star” … café')).toBe('Luna — “the star” … café');
      expect(sanitizeForPdf('Luna 🌟 and the 星 garden')).toBe('Luna  and the  garden');
    });
  });

  describe('renderBookPdf', () => {
    it('resolves to a stream whose first bytes are the PDF magic number', async () => {
      const book = await seededBook();
      const pdf = await collect(await renderBookPdf(book));
      expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1000);
    });

    it('renders a placeholder instead of failing when a page has no illustration', async () => {
      const book = await seededBook();
      expect(book.pages.some(p => p.illustration_url === null)).toBe(true);
      const pdf = await collect(await renderBookPdf(book));
      expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });

    it('embeds an on-disk illustration when one exists', async () => {
      const book = await seededBook();
      await mkdir(ILLUSTRATIONS_DIR, { recursive: true });
      await writeFile(join(ILLUSTRATIONS_DIR, 'page-1.png'), Buffer.from(FAKE_PNG_B64, 'base64'));

      const withImage: PdfBook = {
        ...book,
        pages: book.pages.map((p, i) =>
          i === 0 ? { ...p, illustration_url: `/illustrations/${TEST_BOOK_ID}/page-1.png` } : p,
        ),
      };
      const pdf = await collect(await renderBookPdf(withImage));
      expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });

    it('degrades to the placeholder when an illustration path is missing on disk', async () => {
      const book = await seededBook();
      const broken: PdfBook = {
        ...book,
        pages: book.pages.map((p, i) =>
          i === 0 ? { ...p, illustration_url: '/illustrations/nope/missing.png' } : p,
        ),
      };
      const pdf = await collect(await renderBookPdf(broken));
      expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    });
  });
});
