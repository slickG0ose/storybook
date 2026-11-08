-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "book_id" TEXT,
    "user_agent" TEXT,
    "viewport_width" INTEGER NOT NULL,
    "viewport_height" INTEGER NOT NULL,
    "theme" TEXT NOT NULL,
    "client_build" TEXT,
    "server_build" TEXT,
    "recent_errors_json" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Feedback_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "Book" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Feedback_status_created_at_idx" ON "Feedback"("status", "created_at");

-- CreateIndex
CREATE INDEX "Feedback_user_id_created_at_idx" ON "Feedback"("user_id", "created_at");
