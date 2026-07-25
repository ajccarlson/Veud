CREATE TABLE "ReleaseOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "releaseAt" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "season" INTEGER,
    "episode" INTEGER,
    "volume" INTEGER,
    "chapter" INTEGER,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "observedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "ReleaseOccurrence_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReleaseOccurrence_mediaId_source_sourceKey_key" ON "ReleaseOccurrence"("mediaId", "source", "sourceKey");
CREATE INDEX "ReleaseOccurrence_releaseAt_status_idx" ON "ReleaseOccurrence"("releaseAt", "status");
CREATE INDEX "ReleaseOccurrence_mediaId_releaseAt_idx" ON "ReleaseOccurrence"("mediaId", "releaseAt");
CREATE INDEX "ReleaseOccurrence_expiresAt_idx" ON "ReleaseOccurrence"("expiresAt");
