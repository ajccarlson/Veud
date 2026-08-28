-- Credits can be refreshed independently from a title's metadata. A durable
-- success row distinguishes "the provider returned no cast" from "never
-- fetched", while retry state prevents a bad title from stalling the catalog.
CREATE TABLE "MediaCreditSyncState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastFetchedAt" TIMESTAMP(3),
    "refreshAfter" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "MediaCreditSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaCreditSyncState_mediaId_provider_scope_key"
    ON "MediaCreditSyncState"("mediaId", "provider", "scope");
CREATE INDEX "MediaCreditSyncState_provider_scope_status_refreshAfter_idx"
    ON "MediaCreditSyncState"("provider", "scope", "status", "refreshAfter");
CREATE INDEX "MediaCreditSyncState_mediaId_idx"
    ON "MediaCreditSyncState"("mediaId");

ALTER TABLE "MediaCreditSyncState" ADD CONSTRAINT "MediaCreditSyncState_mediaId_fkey"
    FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
