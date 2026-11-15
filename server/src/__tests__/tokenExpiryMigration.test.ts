import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// #210: the unique index on User.token cannot be built over plaintext rows that
// predate hashing, and those tokens must die anyway. The purge has to run first.
const PURGE = 'UPDATE "User" SET "token" = NULL;';
const prisma = join(__dirname, '..', '..', 'prisma');

function tokenExpirySql(historyDir: string): string {
  const folder = readdirSync(historyDir).find((n) => n.endsWith('_add_token_expiry'));
  expect(folder, `no *_add_token_expiry folder in ${historyDir}`).toBeDefined();
  return readFileSync(join(historyDir, folder as string, 'migration.sql'), 'utf8');
}

describe('add_token_expiry migrations', () => {
  it.each([
    ['sqlite', join(prisma, 'migrations')],
    ['postgres', join(prisma, 'postgres', 'migrations')],
  ])('%s history purges tokens before building the unique index', (_name, dir) => {
    const sql = tokenExpirySql(dir);
    const purgeAt = sql.indexOf(PURGE);
    const indexAt = sql.indexOf('CREATE UNIQUE INDEX');
    expect(purgeAt).toBeGreaterThanOrEqual(0);
    expect(indexAt).toBeGreaterThan(purgeAt);
  });
});
