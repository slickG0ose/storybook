/**
 * Demo account + sample books seed.
 *
 * Creates a persistent demo user (admin role) and upserts every book defined in
 * the JSON fixtures in `prisma/demo-seed-fixtures/`. Each fixture captures a
 * book that was generated end-to-end via the in-app story + illustration
 * pipeline; the PNGs live under `server/public/illustrations/<book-id>/` and
 * are committed alongside the fixture so re-seeding is deterministic and
 * offline.
 *
 * Idempotent: re-running upserts the user and each fixture; no duplicates.
 *
 * Run with: npm run db:seed-demo
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '../../.env'), override: true });

const DEMO_EMAIL = 'demo@storybook.local';
const DEMO_NAME = 'Demo Storyteller';
const DEMO_PASSWORD = 'demo!2026';

const FIXTURES_DIR = join(__dirname, 'demo-seed-fixtures');

interface BookFixture {
  book: {
    id: string;
    title: string;
    author: string;
    description: string;
    theme: string;
    age_range: string;
    cover_emoji: string;
    cover_color: string;
    cover_url: string | null;
    price: number;
    is_featured: boolean;
    is_user_created: boolean;
    status: string;
    version: number;
    characters_json: string | null;
    style_descriptor: string | null;
    style_reference_url: string | null;
    created_at: string;
  };
  pages: {
    page_number: number;
    text: string;
    illustration_description: string;
    illustration_url: string | null;
  }[];
  versions: {
    version: number;
    pages_json: string;
    description: string | null;
    characters_json: string | null;
    created_at: string;
  }[];
  illustration_versions: {
    page_number: number;
    version: number;
    url: string;
    feedback: string | null;
    created_at: string;
  }[];
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

function loadFixtures(): BookFixture[] {
  const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
  return files.map(file => {
    const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
    return JSON.parse(raw) as BookFixture;
  });
}

async function upsertFixture(prisma: PrismaClient, fixture: BookFixture, createdBy: string): Promise<void> {
  const { book, pages, versions, illustration_versions } = fixture;

  const bookData = {
    title: book.title,
    author: book.author,
    description: book.description,
    theme: book.theme,
    age_range: book.age_range,
    cover_emoji: book.cover_emoji,
    cover_color: book.cover_color,
    cover_url: book.cover_url,
    price: book.price,
    is_featured: book.is_featured,
    is_user_created: book.is_user_created,
    status: book.status,
    version: book.version,
    characters_json: book.characters_json,
    style_descriptor: book.style_descriptor,
    style_reference_url: book.style_reference_url,
    created_by: createdBy,
    created_at: new Date(book.created_at),
  };

  const existed = await prisma.book.findUnique({ where: { id: book.id } });
  await prisma.book.upsert({
    where: { id: book.id },
    update: bookData,
    create: { id: book.id, ...bookData },
  });

  for (const page of pages) {
    await prisma.page.upsert({
      where: { book_id_page_number: { book_id: book.id, page_number: page.page_number } },
      update: {
        text: page.text,
        illustration_description: page.illustration_description,
        illustration_url: page.illustration_url,
      },
      create: {
        book_id: book.id,
        page_number: page.page_number,
        text: page.text,
        illustration_description: page.illustration_description,
        illustration_url: page.illustration_url,
      },
    });
  }

  for (const v of versions) {
    await prisma.bookVersion.upsert({
      where: { book_id_version: { book_id: book.id, version: v.version } },
      update: {
        pages_json: v.pages_json,
        description: v.description,
        characters_json: v.characters_json,
        created_at: new Date(v.created_at),
      },
      create: {
        book_id: book.id,
        version: v.version,
        pages_json: v.pages_json,
        description: v.description,
        characters_json: v.characters_json,
        created_at: new Date(v.created_at),
      },
    });
  }

  for (const iv of illustration_versions) {
    await prisma.illustrationVersion.upsert({
      where: {
        book_id_page_number_version: {
          book_id: book.id,
          page_number: iv.page_number,
          version: iv.version,
        },
      },
      update: {
        url: iv.url,
        feedback: iv.feedback,
        created_at: new Date(iv.created_at),
      },
      create: {
        book_id: book.id,
        page_number: iv.page_number,
        version: iv.version,
        url: iv.url,
        feedback: iv.feedback,
        created_at: new Date(iv.created_at),
      },
    });
  }

  const verb = existed ? 'refreshed' : 'inserted';
  console.log(
    `[seed] ${verb} book "${book.title}" (${book.id}): ${pages.length} pages, ` +
      `${versions.length} version(s), ${illustration_versions.length} illustration version(s).`,
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  // Demo user — upsert so reruns also promote the row to admin if it predates
  // OPS.2. The demo account is the canonical admin in this demo project.
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { role: 'admin' },
    create: {
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      password_hash: hashPassword(DEMO_PASSWORD),
      role: 'admin',
    },
  });
  console.log(`[seed] demo user ${DEMO_EMAIL} (id ${user.id}, role ${user.role}). Password: ${DEMO_PASSWORD}`);

  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.warn(`[seed] no fixtures found in ${FIXTURES_DIR}. Nothing to seed.`);
  } else {
    console.log(`[seed] loading ${fixtures.length} fixture(s) from ${FIXTURES_DIR}`);
    for (const fixture of fixtures) {
      await upsertFixture(prisma, fixture, user.id);
    }
  }

  await prisma.$disconnect();
  console.log('\n[seed] done. Log in at /login with:');
  console.log(`  email: ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
