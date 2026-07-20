-- Add timestamped editorial featuring for public collections.

ALTER TABLE "MediaCollection" ADD COLUMN "featuredAt" DATETIME;

CREATE INDEX "MediaCollection_featuredAt_idx" ON "MediaCollection"("featuredAt");
