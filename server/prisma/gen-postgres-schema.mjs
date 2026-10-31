// Generates prisma/postgres/schema.prisma from prisma/schema.prisma.
// Run via: npm run db:gen-postgres-schema
//
// Every Postgres-only edit lives here as an exactly-once needle replacement.
// A needle that matches zero times, or more than once, throws: a reformat of
// schema.prisma must fail loudly rather than silently drop an edit from prod.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

export const HEADER = `// DO NOT EDIT MANUALLY.
// Source of truth: server/prisma/schema.prisma (SQLite, used by local dev + CI).
// Regenerate this file by running: npm run db:gen-postgres-schema
// (from the server/ directory).

`;

const REPLACEMENTS = [
  // Generator block: citext needs the extensions preview feature (Prisma 6).
  {
    needle: 'provider = "prisma-client-js"',
    replacement: 'provider = "prisma-client-js"\n  previewFeatures = ["postgresqlExtensions"]',
  },
  // Datasource block: provider swap.
  {
    needle: 'provider = "sqlite"',
    replacement: 'provider = "postgresql"',
  },
  // Datasource block: install citext.
  {
    needle: 'url      = env("DATABASE_URL")',
    replacement: 'url      = env("DATABASE_URL")\n  extensions = [citext]',
  },
  // model User: case-insensitive unique email (#174, ADR-029).
  {
    needle: 'email         String    @unique',
    replacement: 'email         String    @unique @db.Citext',
  },
];

/**
 * Pure transform: SQLite schema source in, Postgres schema (with HEADER) out.
 * @param {string} sqliteSchema
 * @returns {string}
 */
export function toPostgresSchema(sqliteSchema) {
  let out = sqliteSchema;
  for (const { needle, replacement } of REPLACEMENTS) {
    const count = out.split(needle).length - 1;
    if (count !== 1) {
      throw new Error(
        `gen-postgres-schema: expected exactly one match of ${JSON.stringify(needle)} in schema.prisma, found ${count}`,
      );
    }
    out = out.replace(needle, replacement);
  }
  return HEADER + out;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the SQLite source of truth: server/prisma/schema.prisma. */
const SQLITE_SCHEMA_PATH = join(here, 'schema.prisma');

/**
 * Absolute path of the generated Postgres schema: server/prisma/postgres/schema.prisma.
 * It sits in its own directory so Prisma resolves its migrations to
 * server/prisma/postgres/migrations/, separate from the SQLite history (ADR-028).
 */
export const POSTGRES_SCHEMA_PATH = join(here, 'postgres', 'schema.prisma');

/**
 * Regenerate the Postgres schema from schema.prisma and write it to
 * POSTGRES_SCHEMA_PATH, creating the parent directory if needed.
 * @returns {Promise<string>} the path written
 */
export async function writePostgresSchema() {
  const original = await readFile(SQLITE_SCHEMA_PATH, 'utf8');
  await mkdir(dirname(POSTGRES_SCHEMA_PATH), { recursive: true });
  await writeFile(POSTGRES_SCHEMA_PATH, toPostgresSchema(original));
  return POSTGRES_SCHEMA_PATH;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = await writePostgresSchema();
  console.log(`Wrote ${target}`);
}
