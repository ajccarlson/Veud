CREATE TABLE "MediaSeason" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "installmentCount" INTEGER,
    "releaseStart" TIMESTAMP(3),
    "releaseEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "MediaSeason_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaInstallment" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL DEFAULT 0,
    "number" INTEGER NOT NULL,
    "absoluteNumber" INTEGER,
    "title" TEXT,
    "description" TEXT,
    "releasedAt" TIMESTAMP(3),
    "runtimeMinutes" INTEGER,
    "sourceProvider" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mediaId" TEXT NOT NULL,
    "seasonId" TEXT,

    CONSTRAINT "MediaInstallment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsumptionEvent" (
    "id" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'progress',
    "progressFrom" INTEGER,
    "progressTo" INTEGER,
    "repeatNumber" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "trackingStateId" TEXT,
    "installmentId" TEXT,

    CONSTRAINT "ConsumptionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaSeason_mediaId_number_key" ON "MediaSeason"("mediaId", "number");
CREATE INDEX "MediaSeason_mediaId_releaseStart_idx" ON "MediaSeason"("mediaId", "releaseStart");
CREATE UNIQUE INDEX "MediaInstallment_mediaId_kind_seasonNumber_number_key" ON "MediaInstallment"("mediaId", "kind", "seasonNumber", "number");
CREATE UNIQUE INDEX "MediaInstallment_sourceProvider_kind_sourceId_key" ON "MediaInstallment"("sourceProvider", "kind", "sourceId");
CREATE INDEX "MediaInstallment_mediaId_kind_absoluteNumber_idx" ON "MediaInstallment"("mediaId", "kind", "absoluteNumber");
CREATE INDEX "MediaInstallment_mediaId_releasedAt_idx" ON "MediaInstallment"("mediaId", "releasedAt");
CREATE INDEX "MediaInstallment_seasonId_number_idx" ON "MediaInstallment"("seasonId", "number");
CREATE INDEX "ConsumptionEvent_ownerId_consumedAt_idx" ON "ConsumptionEvent"("ownerId", "consumedAt");
CREATE INDEX "ConsumptionEvent_ownerId_mediaId_consumedAt_idx" ON "ConsumptionEvent"("ownerId", "mediaId", "consumedAt");
CREATE INDEX "ConsumptionEvent_trackingStateId_consumedAt_idx" ON "ConsumptionEvent"("trackingStateId", "consumedAt");
CREATE INDEX "ConsumptionEvent_installmentId_consumedAt_idx" ON "ConsumptionEvent"("installmentId", "consumedAt");

ALTER TABLE "MediaSeason"
ADD CONSTRAINT "MediaSeason_mediaId_fkey"
FOREIGN KEY ("mediaId") REFERENCES "Media"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaInstallment"
ADD CONSTRAINT "MediaInstallment_mediaId_fkey"
FOREIGN KEY ("mediaId") REFERENCES "Media"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaInstallment"
ADD CONSTRAINT "MediaInstallment_seasonId_fkey"
FOREIGN KEY ("seasonId") REFERENCES "MediaSeason"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConsumptionEvent"
ADD CONSTRAINT "ConsumptionEvent_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsumptionEvent"
ADD CONSTRAINT "ConsumptionEvent_mediaId_fkey"
FOREIGN KEY ("mediaId") REFERENCES "Media"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsumptionEvent"
ADD CONSTRAINT "ConsumptionEvent_trackingStateId_fkey"
FOREIGN KEY ("trackingStateId") REFERENCES "TrackingState"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConsumptionEvent"
ADD CONSTRAINT "ConsumptionEvent_installmentId_fkey"
FOREIGN KEY ("installmentId") REFERENCES "MediaInstallment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
