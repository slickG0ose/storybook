// Generates prisma/schema.postgresql.prisma from prisma/schema.prisma.
// Run via: npm run db:gen-postgres-schema
//
// Every Postgres-only edit lives here as an exactly-once needle replacement.
// A needle that matches zero times, or more than once, throws: a reformat of
// schema.prisma must fail loudly rather than silently drop an edit from prod.
import { readFile, writeFile } from 'node:fs/promises';
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = join(here, 'schema.prisma');
  const target = join(here, 'schema.postgresql.prisma');
  const original = await readFile(source, 'utf8');
  await writeFile(target, toPostgresSchema(original));
  console.log(`Wrote ${target}`);
}
