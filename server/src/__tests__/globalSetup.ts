import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';

const serverDir = resolve(import.meta.dirname, '../..');
const TEST_DB_PATH = resolve(serverDir, 'test.db');
const TEST_DATABASE_URL = 'file:./test.db';

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
