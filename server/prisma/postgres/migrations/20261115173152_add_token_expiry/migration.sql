-- #210: every token issued before this migration was stored in plaintext with no
-- expiry. Purge them; each user signs in once. Runs before the unique index is built.
-- (Prepended by hand: a data step Prisma cannot generate. The DDL below is migrate diff output.)
UPDATE "User" SET "token" = NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "token_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_token_key" ON "User"("token");
