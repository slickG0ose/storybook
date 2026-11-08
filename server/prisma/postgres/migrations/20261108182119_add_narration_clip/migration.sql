-- CreateTable
CREATE TABLE "NarrationClip" (
    "id" SERIAL NOT NULL,
    "book_id" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "voice_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "chars" INTEGER NOT NULL,
    "segments_json" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NarrationClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NarrationClip_book_id_slot_voice_id_model_text_hash_key" ON "NarrationClip"("book_id", "slot", "voice_id", "model", "text_hash");

-- AddForeignKey
ALTER TABLE "NarrationClip" ADD CONSTRAINT "NarrationClip_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
