-- Tracking V2, phase 1: introduce provider-backed media identity without
-- rewriting or deleting any existing entry/favorite data. Existing records stay
-- nullable until the repeatable backfill script links them.

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MediaExternalId" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "MediaExternalId_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "mediaId" TEXT REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "UserFavorite" ADD COLUMN "mediaId" TEXT REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Media_kind_idx" ON "Media"("kind");

-- CreateIndex
CREATE INDEX "MediaExternalId_mediaId_idx" ON "MediaExternalId"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaExternalId_provider_kind_externalId_key" ON "MediaExternalId"("provider", "kind", "externalId");

-- CreateIndex
CREATE INDEX "Entry_mediaId_idx" ON "Entry"("mediaId");

-- CreateIndex
CREATE INDEX "UserFavorite_mediaId_idx" ON "UserFavorite"("mediaId");
