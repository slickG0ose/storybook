import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPostgresSchema } from '../../prisma/gen-postgres-schema.mjs';

/**
 * Pins `prisma/gen-postgres-schema.mjs`, the generator that derives the production
 * (Postgres) schema from the SQLite one (#174, ADR-029).
 *
 * Three guarantees:
 * 1. Drift: the committed `schema.postgresql.prisma` is exactly what the generator
 *    produces today. A hand-edit, or a `schema.prisma` change without regenerating,
 *    fails here instead of silently diverging from what Render's `db push` applies.
 * 2. citext: the Postgres output carries the three pieces that make `User.email`
 *    case-insensitive unique, and the SQLite source carries none of them.
 * 3. Loud failure: every needle must match exactly once, so a reformat of
 *    `schema.prisma` cannot quietly drop citext from prod.
 *
 * App-level normalisation is covered in `src/routes/__tests__/auth-normalization.test.ts`.
 */

const PRISMA_DIR = join(import.meta.dirname, '..', '..', 'prisma');
const sqliteSchema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
const committedPostgres = readFileSync(join(PRISMA_DIR, 'schema.postgresql.prisma'), 'utf8');

const NEEDLES = {
  generatorProvider: 'provider = "prisma-client-js"',
  datasourceProvider: 'provider = "sqlite"',
  datasourceUrl: 'url      = env("DATABASE_URL")',
  userEmail: 'email         String    @unique',
} as const;

/** The `model User { ... }` block of a schema source. */
function userModel(schema: string): string {
  const match = schema.match(/model User \{[\s\S]*?\n\}/);
  if (!match) throw new Error('model User block not found');
  return match[0];
}

describe('gen-postgres-schema', () => {
  it('committed schema.postgresql.prisma matches generator output (run `npm run db:gen-postgres-schema` from server/ if this fails)', () => {
    const generated = toPostgresSchema(sqliteSchema);
    // Compare as a boolean first so the failure message carries the fix, then
    // as strings so vitest prints the diff.
    expect(
      generated === committedPostgres,
      'schema.postgresql.prisma is out of date or was hand-edited. Run `npm run db:gen-postgres-schema` from server/ and commit the result.',
    ).toBe(true);
    expect(generated).toBe(committedPostgres);
  });

  it('generated output carries the citext pieces', () => {
    const generated = toPostgresSchema(sqliteSchema);
    expect(generated).toContain('previewFeatures = ["postgresqlExtensions"]');
    expect(generated).toContain('extensions = [citext]');
    expect(generated).toContain('provider = "postgresql"');
    expect(generated).not.toContain('provider = "sqlite"');
    expect(userModel(generated)).toMatch(/^\s*email\s+String\s+@unique @db\.Citext\s*$/m);
  });

  it('only User.email becomes citext', () => {
    const generated = toPostgresSchema(sqliteSchema);
    expect(generated.split('@db.Citext').length - 1).toBe(1);
  });

  it('schema.prisma (SQLite) contains no Postgres-only citext pieces', () => {
    expect(sqliteSchema).not.toContain('citext');
    expect(sqliteSchema).not.toContain('Citext');
    expect(sqliteSchema).not.toContain('postgresqlExtensions');
  });

  describe('fails loudly when a needle does not match exactly once', () => {
    for (const [name, needle] of Object.entries(NEEDLES)) {
      it(`throws when ${name} is missing`, () => {
        expect(sqliteSchema.split(needle).length - 1).toBe(1);
        // Alter, not delete: a reformat (extra space) is the realistic failure.
        const altered = sqliteSchema.replace(needle, needle.replace(' ', '  '));
        expect(() => toPostgresSchema(altered)).toThrow(`${JSON.stringify(needle)} in schema.prisma, found 0`);
      });
    }

    it('throws when the User.email needle appears twice', () => {
      // A second model with the same column layout is the realistic way this happens.
      const twice = `${sqliteSchema}\nmodel Other {\n  id            String    @id\n  ${NEEDLES.userEmail}\n}\n`;
      expect(twice.split(NEEDLES.userEmail).length - 1).toBe(2);
      expect(() => toPostgresSchema(twice)).toThrow(/found 2/);
    });
  });
});
