// Creates the next Postgres migration under prisma/postgres/migrations/ (ADR-028).
// Run via: npm run db:migrate:postgres -- <name>
//
// Each migration folder holds migration.sql plus schema.prisma, a byte copy of
// prisma/postgres/schema.prisma as of that migration. The latest snapshot is
// what the next migration diffs against, and what postgresMigrations.test.ts
// compares with the current generated schema. Everything here is DB-less:
// `prisma migrate diff` between two datamodels needs no database.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { POSTGRES_SCHEMA_PATH, writePostgresSchema } from './gen-postgres-schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** server/ — Prisma is spawned from here so `npx prisma` resolves the local CLI. */
const SERVER_DIR = dirname(here);

/** Absolute path of the Postgres migration history: server/prisma/postgres/migrations. */
export const POSTGRES_MIGRATIONS_DIR = join(here, 'postgres', 'migrations');

/** SQL lines that can lose data. Matched lines are printed for review, never blocked. */
const DESTRUCTIVE_LINE = /\bDROP\b|ALTER COLUMN .* TYPE/i;

const NAME_PATTERN = /^[a-z0-9_]+$/;

/**
 * Where a migration folder's schema snapshot lives. This is the ONLY place that
 * knows the snapshot location; switching to a single snapshot file means
 * changing this function (and losing "cannot bump without a migration").
 * @param {string} migrationDir
 * @returns {string}
 */
export function snapshotPathFor(migrationDir) {
  return join(migrationDir, 'schema.prisma');
}

/**
 * Migration folder names, sorted with plain string compare (Prisma's order).
 * Files such as migration_lock.toml are excluded.
 * @param {string} [migrationsDir]
 * @returns {string[]}
 */
export function listMigrations(migrationsDir = POSTGRES_MIGRATIONS_DIR) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Absolute path of the newest migration folder.
 * @param {string} [migrationsDir]
 * @returns {string}
 */
export function latestMigrationDir(migrationsDir = POSTGRES_MIGRATIONS_DIR) {
  const names = listMigrations(migrationsDir);
  if (names.length === 0) {
    throw new Error(`postgres-migrations: no migration folders in ${migrationsDir}`);
  }
  return join(migrationsDir, names[names.length - 1]);
}

/**
 * `${YYYYMMDDHHMMSS in UTC}_${name}` — the same timestamp shape `prisma migrate dev` uses.
 * @param {string} name
 * @param {Date} [now]
 * @returns {string}
 */
export function migrationFolderName(name, now = new Date()) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(
      `postgres-migrations: invalid migration name ${JSON.stringify(name)}; use lowercase letters, digits, and underscores only`,
    );
  }
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    String(now.getUTCFullYear()) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds());
  return `${stamp}_${name}`;
}

/**
 * Child env for Prisma: everything from process.env except DATABASE_URL.
 * Unset is the verified case for a datamodel-to-datamodel diff. Note the Prisma
 * CLI still loads `server/.env` from its cwd, so locally the child sees that
 * file's `file:` URL again; CI has no `.env` and runs the unset case. Either
 * way the guard only passes on exit 0, so a wrong env can fail red, never green.
 * @returns {NodeJS.ProcessEnv}
 */
export function prismaEnv() {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  return env;
}

/**
 * @param {string[]} args
 */
function runPrisma(args) {
  // --no-install: a missing local Prisma fails instead of prompting to download.
  const result = spawnSync('npx', ['--no-install', 'prisma', ...args], {
    cwd: SERVER_DIR,
    env: prismaEnv(),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    // null status means the process was killed or never started; report it as a failure.
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '') + (result.error ? String(result.error) : ''),
  };
}

/**
 * `prisma migrate diff --exit-code` between two datamodels.
 * 0 = no difference, 2 = difference, anything else = error.
 * @param {string} fromSchema
 * @param {string} toSchema
 * @returns {{ status: number; stderr: string }}
 */
export function diffExitCode(fromSchema, toSchema) {
  const { status, stderr } = runPrisma([
    'migrate',
    'diff',
    '--from-schema-datamodel',
    fromSchema,
    '--to-schema-datamodel',
    toSchema,
    '--exit-code',
  ]);
  return { status, stderr };
}

/**
 * Create the next Postgres migration if the schema differs from the latest snapshot.
 * Does not regenerate the Postgres schema; the CLI does that first.
 * Throws if Prisma errors; a half-made folder is removed before throwing.
 * @param {{ name: string; migrationsDir?: string; schemaPath?: string; now?: Date }} opts
 * @returns {{ created: false; reason: string } | { created: true; dir: string; destructive: string[] }}
 */
export function createMigration({
  name,
  migrationsDir = POSTGRES_MIGRATIONS_DIR,
  schemaPath = POSTGRES_SCHEMA_PATH,
  now = new Date(),
}) {
  const folder = migrationFolderName(name, now);
  const latest = latestMigrationDir(migrationsDir);
  const snapshot = snapshotPathFor(latest);

  const diff = diffExitCode(snapshot, schemaPath);
  if (diff.status === 0) {
    return {
      created: false,
      reason: `No Postgres schema change since ${latest.split(/[\\/]/).pop()}; no migration created.`,
    };
  }
  if (diff.status !== 2) {
    throw new Error(
      `postgres-migrations: prisma migrate diff exited ${diff.status}\n${diff.stderr}`,
    );
  }

  const dir = join(migrationsDir, folder);
  if (existsSync(dir)) {
    throw new Error(`postgres-migrations: ${dir} already exists`);
  }
  mkdirSync(dir);
  try {
    const sqlPath = join(dir, 'migration.sql');
    const out = runPrisma([
      'migrate',
      'diff',
      '--from-schema-datamodel',
      snapshot,
      '--to-schema-datamodel',
      schemaPath,
      '--script',
      '--output',
      sqlPath,
    ]);
    if (out.status !== 0 || !existsSync(sqlPath)) {
      throw new Error(
        `postgres-migrations: prisma migrate diff --script exited ${out.status}\n${out.stderr}`,
      );
    }
    copyFileSync(schemaPath, snapshotPathFor(dir));
    const destructive = readFileSync(sqlPath, 'utf8')
      .split('\n')
      .filter((line) => DESTRUCTIVE_LINE.test(line));
    return { created: true, dir, destructive };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * @param {string[]} args
 * @returns {string | undefined}
 */
function parseName(args) {
  const flag = args.indexOf('--name');
  if (flag !== -1) return args[flag + 1];
  return args.find((arg) => !arg.startsWith('-'));
}

const USAGE = `Usage: npm run db:migrate:postgres -- <name>
       npm run db:migrate:postgres -- --name <name>
<name> uses lowercase letters, digits, and underscores only (e.g. add_book_subtitle).`;

async function main() {
  const name = parseName(process.argv.slice(2));
  if (!name || !NAME_PATTERN.test(name)) {
    console.error(USAGE);
    process.exit(1);
  }

  await writePostgresSchema();

  let result;
  try {
    result = createMigration({ name });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!result.created) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log(`Created ${result.dir}`);
  if (result.destructive.length > 0) {
    console.warn('\nWARNING: review for data loss. These lines can drop or rewrite data:');
    for (const line of result.destructive) console.warn(`  ${line}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
