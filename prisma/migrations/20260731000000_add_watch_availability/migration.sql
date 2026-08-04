-- Where a title can be watched, per region and per kind of offer.
CREATE TABLE "WatchAvailability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'tmdb',
    "region" TEXT NOT NULL,
    "offerKind" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "logoPath" TEXT,
    "displayPriority" INTEGER NOT NULL DEFAULT 0,
    "link" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "WatchAvailability_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WatchAvailability_mediaId_region_offerKind_providerId_key"
    ON "WatchAvailability"("mediaId", "region", "offerKind", "providerId");
CREATE INDEX "WatchAvailability_mediaId_region_displayPriority_idx"
    ON "WatchAvailability"("mediaId", "region", "displayPriority");
CREATE INDEX "WatchAvailability_expiresAt_idx" ON "WatchAvailability"("expiresAt");
