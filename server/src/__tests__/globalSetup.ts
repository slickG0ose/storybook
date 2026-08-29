import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';

const serverDir = resolve(import.meta.dirname, '../..');

/**
 * Where the test database ACTUALLY lives.
 *
 * `DATABASE_URL` below is `file:./test.db`, and the obvious reading — that the
 * `.` is the process cwd, i.e. `server/` — is wrong. Prisma resolves a relative
 * SQLite path against the **schema file's** directory, so the database is created
 * at `server/prisma/test.db`.
 *
 * This constant used to point at `server/test.db`, a path that never exists. Both
 * `unlinkSync` calls below were therefore silent no-ops guarded by `existsSync`,
 * and `test.db` survived every run and every teardown — the exact opposite of what
 * the comments in this file claim. `resolvedTestDbExists()` is asserted by
 * `globalSetup.test.ts` so this cannot rot back.
 */
export const TEST_DB_PATH = resolve(serverDir, 'prisma', 'test.db');
const TEST_DATABASE_URL = 'file:./test.db';

/** Exported for the pin in `globalSetup.test.ts`. */
export function resolvedTestDbExists(): boolean {
  return existsSync(TEST_DB_PATH);
}

export async function setup() {
  // Start clean — remove any test.db left over from a prior crashed run.
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);

  // Apply migrations to test.db so its schema matches dev.db.
  // Use `npx prisma` so this works whether prisma is hoisted by npm workspaces
  // or installed locally to server/node_modules.
  // NODE_TLS_REJECT_UNAUTHORIZED=0 mirrors what server/src/index.ts does — Prisma
  // downloads its query engine binary over HTTPS and the corporate proxy uses a
  // self-signed cert.
  execSync('npx prisma migrate deploy', {
    cwd: serverDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    },
  });
}

export async function teardown() {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
}
