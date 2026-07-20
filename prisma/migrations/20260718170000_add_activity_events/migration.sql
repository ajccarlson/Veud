-- Tracking V2, phase 5: add an append-only activity stream for status,
-- rating, and progress changes. Existing legacy history remains readable but
-- is not synthesized into events, avoiding misleading timestamps.

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "statusLabel" TEXT,
    "previousStatus" TEXT,
    "previousStatusLabel" TEXT,
    "score" DECIMAL,
    "previousScore" DECIMAL,
    "progressUnit" TEXT,
    "progressCurrent" INTEGER,
    "progressPrevious" INTEGER,
    "progressTotal" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "trackingStateId" TEXT,
    CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityEvent_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityEvent_trackingStateId_fkey" FOREIGN KEY ("trackingStateId") REFERENCES "TrackingState" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ActivityEvent_actorId_createdAt_idx" ON "ActivityEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_mediaId_createdAt_idx" ON "ActivityEvent"("mediaId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_trackingStateId_idx" ON "ActivityEvent"("trackingStateId");

-- CreateIndex
CREATE INDEX "ActivityEvent_type_createdAt_idx" ON "ActivityEvent"("type", "createdAt");
