-- CreateTable
CREATE TABLE "IllustrationVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "book_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "feedback" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IllustrationVersion_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "IllustrationVersion_book_id_page_number_version_key" ON "IllustrationVersion"("book_id", "page_number", "version");
