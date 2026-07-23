CREATE TABLE "LibraryImportBatch" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "itemCount" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL,
    "ambiguousCount" INTEGER NOT NULL,
    "unmatchedCount" INTEGER NOT NULL,
    "conflictCount" INTEGER NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "LibraryImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryImportItem" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "matchState" TEXT NOT NULL,
    "matchMethod" TEXT,
    "hasConflict" BOOLEAN NOT NULL DEFAULT false,
    "candidates" TEXT NOT NULL DEFAULT '[]',
    "resolution" TEXT NOT NULL DEFAULT 'skip',
    "journal" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchId" TEXT NOT NULL,
    "mediaId" TEXT,
    CONSTRAINT "LibraryImportItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LibraryImportBatch_ownerId_createdAt_idx" ON "LibraryImportBatch"("ownerId", "createdAt");
CREATE INDEX "LibraryImportBatch_status_createdAt_idx" ON "LibraryImportBatch"("status", "createdAt");
CREATE UNIQUE INDEX "LibraryImportItem_batchId_sourceKey_key" ON "LibraryImportItem"("batchId", "sourceKey");
CREATE INDEX "LibraryImportItem_batchId_matchState_idx" ON "LibraryImportItem"("batchId", "matchState");
CREATE INDEX "LibraryImportItem_mediaId_idx" ON "LibraryImportItem"("mediaId");

ALTER TABLE "LibraryImportBatch" ADD CONSTRAINT "LibraryImportBatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryImportItem" ADD CONSTRAINT "LibraryImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LibraryImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryImportItem" ADD CONSTRAINT "LibraryImportItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
