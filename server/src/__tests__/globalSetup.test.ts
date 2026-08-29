import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { TEST_DB_PATH, resolvedTestDbExists } from './globalSetup';

/**
 * Pins where the test database really is (#97).
 *
 * `globalSetup.ts` deletes `TEST_DB_PATH` before the run and again at teardown, so
 * that each run starts from a freshly migrated database. That only works if the
 * constant points at the file Prisma actually creates — and for a long time it did
 * not. `DATABASE_URL` is `file:./test.db`, which reads as `server/test.db`, but
 * Prisma resolves relative SQLite paths against the SCHEMA directory, so the real
 * file is `server/prisma/test.db`.
 *
 * The failure was completely silent: both `unlinkSync` calls sit behind
 * `existsSync`, so a wrong path is not an error, it is a no-op. The database simply
 * persisted across every run, and the file's own comments said the opposite.
 *
 * This test is cheap and blunt on purpose. If the suite is running, the database
 * exists; if `TEST_DB_PATH` does not point at it, the "start clean" guarantee is
 * false again and this goes red.
 */
describe('globalSetup test-database path', () => {
  it('points at the file Prisma actually creates', () => {
    expect(
      resolvedTestDbExists(),
      `TEST_DB_PATH is ${TEST_DB_PATH}, but no database exists there while the suite is ` +
        'running. Prisma resolves a relative SQLite URL against the schema directory ' +
        '(server/prisma/), not the cwd — so setup and teardown are deleting nothing and ' +
        'test.db is surviving between runs.',
    ).toBe(true);
  });

  it('resolves under server/prisma/, not server/', () => {
    // Named explicitly rather than derived, so changing the resolve() call forces a
    // change here too — and an explanation of why the layout moved.
    const serverDir = resolve(import.meta.dirname, '../..');
    expect(TEST_DB_PATH).toBe(resolve(serverDir, 'prisma', 'test.db'));
    expect(existsSync(resolve(serverDir, 'test.db'))).toBe(false);
  });
});
