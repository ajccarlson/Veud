-- SQLite cannot add a non-constant CURRENT_TIMESTAMP default to a populated
-- table. Rebuild the identity table so existing rows are preserved and receive
-- a deterministic first/last-seen backfill at migration time.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_MediaExternalId" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceUpdatedAt" DATETIME,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFetchedAt" DATETIME,
    "refreshAfter" DATETIME,
    "tombstonedAt" DATETIME,
    "fetchStatus" TEXT NOT NULL DEFAULT 'pending',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "MediaExternalId_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_MediaExternalId" (
    "id",
    "provider",
    "kind",
    "externalId",
    "firstSeenAt",
    "lastSeenAt",
    "mediaId"
)
SELECT
    "id",
    "provider",
    "kind",
    "externalId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    "mediaId"
FROM "MediaExternalId";

DROP TABLE "MediaExternalId";
ALTER TABLE "new_MediaExternalId" RENAME TO "MediaExternalId";

CREATE INDEX "MediaExternalId_mediaId_idx"
ON "MediaExternalId"("mediaId");

CREATE UNIQUE INDEX "MediaExternalId_provider_kind_externalId_key"
ON "MediaExternalId"("provider", "kind", "externalId");

CREATE INDEX "MediaExternalId_provider_kind_fetchStatus_refreshAfter_idx"
ON "MediaExternalId"("provider", "kind", "fetchStatus", "refreshAfter");

CREATE INDEX "MediaExternalId_provider_kind_lastSeenAt_idx"
ON "MediaExternalId"("provider", "kind", "lastSeenAt");

CREATE INDEX "MediaExternalId_tombstonedAt_idx"
ON "MediaExternalId"("tombstonedAt");

PRAGMA foreign_keys=ON;

CREATE TABLE "MediaTitle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT '',
    "titleType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "MediaTitle_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MediaTitle_mediaId_provider_language_titleType_value_key"
ON "MediaTitle"("mediaId", "provider", "language", "titleType", "value");

CREATE INDEX "MediaTitle_mediaId_provider_idx"
ON "MediaTitle"("mediaId", "provider");

CREATE INDEX "MediaTitle_normalized_idx" ON "MediaTitle"("normalized");

CREATE TABLE "CatalogSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "leaseOwner" TEXT NOT NULL,
    "cursor" TEXT,
    "recordsSeen" INTEGER NOT NULL DEFAULT 0,
    "recordsHandled" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "CatalogSyncRun_provider_kind_mode_startedAt_idx"
ON "CatalogSyncRun"("provider", "kind", "mode", "startedAt");

CREATE INDEX "CatalogSyncRun_status_heartbeatAt_idx"
ON "CatalogSyncRun"("status", "heartbeatAt");

CREATE TABLE "CatalogSyncCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "cursor" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" DATETIME,
    "lastSuccessfulAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CatalogSyncCursor_provider_kind_mode_key"
ON "CatalogSyncCursor"("provider", "kind", "mode");

CREATE INDEX "CatalogSyncCursor_leaseExpiresAt_idx"
ON "CatalogSyncCursor"("leaseExpiresAt");
