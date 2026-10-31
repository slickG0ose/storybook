import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POSTGRES_SCHEMA_PATH } from '../../prisma/gen-postgres-schema.mjs';
import {
  POSTGRES_MIGRATIONS_DIR,
  createMigration,
  diffExitCode,
  latestMigrationDir,
  listMigrations,
  migrationFolderName,
  snapshotPathFor,
} from '../../prisma/postgres-migrations.mjs';

/**
 * DB-less drift guard for the Postgres migration history (ADR-028).
 *
 * Render's build runs `prisma migrate deploy` over `prisma/postgres/migrations/`.
 * A `schema.prisma` change that regenerates `postgres/schema.prisma` but adds no
 * Postgres migration would deploy green and never reach prod. The guard below
 * diffs the latest migration's schema snapshot against the current generated
 * schema with `prisma migrate diff --exit-code`, which needs no database.
 *
 * The SQLite history (`prisma/migrations/`) is separate and untouched here.
 */

const PRISMA_DIR = join(import.meta.dirname, '..', '..', 'prisma');
const POSTGRES_DIR = join(PRISMA_DIR, 'postgres');
const PRISMA_TIMEOUT = 30_000;

/** Recursive listing of server/prisma/postgres/, to prove the tests write nothing there. */
function listTree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();
}

describe('postgres migrations', () => {
  it(
    'latest migration snapshot matches postgres/schema.prisma',
    () => {
      const latest = latestMigrationDir();
      const { status, stderr } = diffExitCode(snapshotPathFor(latest), POSTGRES_SCHEMA_PATH);
      const msg =
        status === 2
          ? 'Postgres schema changed without a Postgres migration. Run `cd server && npm run db:migrate:postgres -- <name>` and commit the new folder.'
          : `prisma migrate diff exited ${status} comparing ${latest} with postgres/schema.prisma:\n${stderr}`;
      expect(status === 0, msg).toBe(true);
    },
    PRISMA_TIMEOUT,
  );

  describe('layout', () => {
    it('every migration folder has migration.sql and schema.prisma', () => {
      const names = listMigrations();
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const dir = join(POSTGRES_MIGRATIONS_DIR, name);
        expect(existsSync(join(dir, 'migration.sql')), `${name}/migration.sql missing`).toBe(true);
        expect(existsSync(snapshotPathFor(dir)), `${name}/schema.prisma missing`).toBe(true);
      }
    });

    it('lock file says postgresql', () => {
      const lock = readFileSync(join(POSTGRES_MIGRATIONS_DIR, 'migration_lock.toml'), 'utf8');
      expect(lock).toContain('provider = "postgresql"');
    });

    it('first migration is 0_init', () => {
      expect(listMigrations()[0]).toBe('0_init');
    });
  });

  describe('no sharing with the SQLite history', () => {
    it('SQLite lock still says sqlite and has no 0_init', () => {
      const sqliteMigrations = join(PRISMA_DIR, 'migrations');
      expect(readFileSync(join(sqliteMigrations, 'migration_lock.toml'), 'utf8')).toContain(
        'provider = "sqlite"',
      );
      expect(existsSync(join(sqliteMigrations, '0_init'))).toBe(false);
    });

    it('old schema.postgresql.prisma path is gone', () => {
      expect(existsSync(join(PRISMA_DIR, 'schema.postgresql.prisma'))).toBe(false);
    });
  });

  it('0_init creates the citext extension and the citext email column', () => {
    const sql = readFileSync(join(POSTGRES_MIGRATIONS_DIR, '0_init', 'migration.sql'), 'utf8');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "citext"');
    expect(sql).toContain('"email" CITEXT');
  });

  describe('pure helpers', () => {
    it('migrationFolderName prefixes a UTC timestamp', () => {
      expect(migrationFolderName('add_x', new Date(Date.UTC(2026, 9, 31, 1, 2, 3)))).toBe(
        '20261031010203_add_x',
      );
    });

    it.each(['', 'Add-X', '../x'])('migrationFolderName rejects %j', (name) => {
      expect(() => migrationFolderName(name)).toThrow(/invalid migration name/);
    });

    it('listMigrations sorts 0_init before timestamped folders', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pg-migrations-list-'));
      try {
        for (const name of ['20261031010203_b', '0_init', '20250101000000_a']) {
          cpSync(join(POSTGRES_MIGRATIONS_DIR, '0_init'), join(dir, name), { recursive: true });
        }
        writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
        expect(listMigrations(dir)).toEqual(['0_init', '20250101000000_a', '20261031010203_b']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('createMigration (temp dir)', () => {
    let tmp: string;
    let migrationsDir: string;
    let postgresTreeBefore: string[];
    /** The copied 0_init snapshot: the baseline for both cases, so live-schema drift only trips the guard above. */
    let baseSchemaPath: string;
    const now = new Date(Date.UTC(2026, 9, 31, 1, 2, 3));

    beforeAll(() => {
      postgresTreeBefore = listTree(POSTGRES_DIR);
      tmp = mkdtempSync(join(tmpdir(), 'pg-migrations-create-'));
      migrationsDir = join(tmp, 'migrations');
      cpSync(join(POSTGRES_MIGRATIONS_DIR, '0_init'), join(migrationsDir, '0_init'), {
        recursive: true,
      });
      baseSchemaPath = snapshotPathFor(join(migrationsDir, '0_init'));
    });

    afterAll(() => {
      rmSync(tmp, { recursive: true, force: true });
      // Never write inside server/prisma/postgres/.
      expect(listTree(POSTGRES_DIR)).toEqual(postgresTreeBefore);
    });

    it(
      'creates nothing when the schema is unchanged',
      () => {
        const result = createMigration({
          name: 'noop',
          migrationsDir,
          schemaPath: baseSchemaPath,
          now,
        });
        expect(result.created).toBe(false);
        expect(listMigrations(migrationsDir)).toEqual(['0_init']);
      },
      PRISMA_TIMEOUT,
    );

    it(
      'creates a migration folder with SQL and a snapshot when the schema changes',
      () => {
        const base = readFileSync(baseSchemaPath, 'utf8');
        expect(base.split('model Book {\n').length - 1).toBe(1);
        const changed = base.replace('model Book {\n', 'model Book {\n  tempField String?\n');
        const schemaPath = join(tmp, 'schema.prisma');
        writeFileSync(schemaPath, changed);

        const result = createMigration({ name: 'add_temp', migrationsDir, schemaPath, now });
        expect(result.created).toBe(true);
        if (!result.created) return;

        expect(result.dir).toBe(join(migrationsDir, '20261031010203_add_temp'));
        expect(listMigrations(migrationsDir)).toEqual(['0_init', '20261031010203_add_temp']);
        expect(readFileSync(join(result.dir, 'migration.sql'), 'utf8')).toContain(
          'ALTER TABLE "Book" ADD COLUMN',
        );
        expect(readFileSync(snapshotPathFor(result.dir), 'utf8')).toBe(changed);
        expect(result.destructive).toEqual([]);
      },
      PRISMA_TIMEOUT,
    );
  });
});
