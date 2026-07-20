-- Tracking V2, phase 2: normalize each user's current state for a canonical
-- work while leaving Entry and its history JSON intact during the transition.

-- CreateTable
CREATE TABLE "TrackingState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "score" DECIMAL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "repeatCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "statusWatchlistId" TEXT,
    CONSTRAINT "TrackingState_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackingState_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackingState_statusWatchlistId_fkey" FOREIGN KEY ("statusWatchlistId") REFERENCES "Watchlist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackingProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unit" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    "trackingStateId" TEXT NOT NULL,
    CONSTRAINT "TrackingProgress_trackingStateId_fkey" FOREIGN KEY ("trackingStateId") REFERENCES "TrackingState" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "trackingStateId" TEXT REFERENCES "TrackingState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "TrackingState_ownerId_mediaId_key" ON "TrackingState"("ownerId", "mediaId");

-- CreateIndex
CREATE INDEX "TrackingState_mediaId_idx" ON "TrackingState"("mediaId");

-- CreateIndex
CREATE INDEX "TrackingState_statusWatchlistId_idx" ON "TrackingState"("statusWatchlistId");

-- CreateIndex
CREATE INDEX "TrackingState_ownerId_status_idx" ON "TrackingState"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingProgress_trackingStateId_unit_key" ON "TrackingProgress"("trackingStateId", "unit");

-- CreateIndex
CREATE INDEX "TrackingProgress_trackingStateId_idx" ON "TrackingProgress"("trackingStateId");

-- CreateIndex
CREATE INDEX "Entry_trackingStateId_idx" ON "Entry"("trackingStateId");
