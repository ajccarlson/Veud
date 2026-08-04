-- Where a title can be watched, per region and per kind of offer.
CREATE TABLE "WatchAvailability" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'tmdb',
    "region" TEXT NOT NULL,
    "offerKind" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "logoPath" TEXT,
    "displayPriority" INTEGER NOT NULL DEFAULT 0,
    "link" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "WatchAvailability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WatchAvailability_mediaId_region_offerKind_providerId_key"
    ON "WatchAvailability"("mediaId", "region", "offerKind", "providerId");
CREATE INDEX "WatchAvailability_mediaId_region_displayPriority_idx"
    ON "WatchAvailability"("mediaId", "region", "displayPriority");
CREATE INDEX "WatchAvailability_expiresAt_idx" ON "WatchAvailability"("expiresAt");

ALTER TABLE "WatchAvailability" ADD CONSTRAINT "WatchAvailability_mediaId_fkey"
    FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
