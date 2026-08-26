-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "age_range" TEXT NOT NULL,
    "cover_emoji" TEXT NOT NULL,
    "cover_color" TEXT NOT NULL,
    "cover_url" TEXT,
    "price" REAL NOT NULL,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_user_created" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'published',
    "version" INTEGER NOT NULL DEFAULT 1,
    "characters_json" TEXT,
    "style_descriptor" TEXT,
    "style_reference_url" TEXT,
    "image_provider" TEXT,
    "image_model" TEXT,
    "created_by" TEXT,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_hero_eligible" BOOLEAN NOT NULL DEFAULT false,
    "hero_consent_at" DATETIME,
    CONSTRAINT "Book_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Book" ("age_range", "author", "characters_json", "cover_color", "cover_emoji", "cover_url", "created_at", "created_by", "deleted_at", "description", "id", "image_model", "image_provider", "is_featured", "is_user_created", "price", "status", "style_descriptor", "style_reference_url", "theme", "title", "version") SELECT "age_range", "author", "characters_json", "cover_color", "cover_emoji", "cover_url", "created_at", "created_by", "deleted_at", "description", "id", "image_model", "image_provider", "is_featured", "is_user_created", "price", "status", "style_descriptor", "style_reference_url", "theme", "title", "version" FROM "Book";
DROP TABLE "Book";
ALTER TABLE "new_Book" RENAME TO "Book";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
