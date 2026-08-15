-- CreateTable
CREATE TABLE "AllowedEmail" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "added_by" TEXT,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
