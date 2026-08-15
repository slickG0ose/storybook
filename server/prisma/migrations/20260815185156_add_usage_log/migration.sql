-- CreateTable
CREATE TABLE "UsageLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "UsageLog_user_id_created_at_idx" ON "UsageLog"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "UsageLog_created_at_idx" ON "UsageLog"("created_at");
