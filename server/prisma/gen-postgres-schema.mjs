// Generates prisma/schema.postgresql.prisma from prisma/schema.prisma by
// swapping the datasource provider. Run via: npm run db:gen-postgres-schema
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'schema.prisma');
const target = join(here, 'schema.postgresql.prisma');

const header = `// DO NOT EDIT MANUALLY.
// Source of truth: server/prisma/schema.prisma (SQLite, used by local dev + CI).
// Regenerate this file by running: npm run db:gen-postgres-schema
// (from the server/ directory).

`;

const original = await readFile(source, 'utf8');
const needle = 'provider = "sqlite"';
if (!original.includes(needle)) {
  throw new Error(`Expected to find ${needle} in ${source}`);
}
const swapped = original.replace(needle, 'provider = "postgresql"');
await writeFile(target, header + swapped);
console.log(`Wrote ${target}`);
