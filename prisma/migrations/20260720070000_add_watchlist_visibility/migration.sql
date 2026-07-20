-- Preserve today's public-list behavior while allowing members to opt individual
-- watchlists out of public routes, profiles, feeds, and aggregate discovery.
ALTER TABLE "Watchlist" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Watchlist_ownerId_isPublic_idx" ON "Watchlist"("ownerId", "isPublic");

-- Activity keeps the visibility and list provenance from the moment an event is
-- created. This prevents a private status name or title from leaking after the
-- tracking state later moves to a different list.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ActivityEvent" (
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
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "trackingStateId" TEXT,
    "statusWatchlistId" TEXT,
    "previousStatusWatchlistId" TEXT,
    CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityEvent_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityEvent_trackingStateId_fkey" FOREIGN KEY ("trackingStateId") REFERENCES "TrackingState" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityEvent_statusWatchlistId_fkey" FOREIGN KEY ("statusWatchlistId") REFERENCES "Watchlist" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityEvent_previousStatusWatchlistId_fkey" FOREIGN KEY ("previousStatusWatchlistId") REFERENCES "Watchlist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ActivityEvent" (
    "id",
    "type",
    "status",
    "statusLabel",
    "previousStatus",
    "previousStatusLabel",
    "score",
    "previousScore",
    "progressUnit",
    "progressCurrent",
    "progressPrevious",
    "progressTotal",
    "createdAt",
    "actorId",
    "mediaId",
    "trackingStateId",
    "statusWatchlistId",
    "previousStatusWatchlistId"
)
SELECT
    event."id",
    event."type",
    event."status",
    event."statusLabel",
    event."previousStatus",
    event."previousStatusLabel",
    event."score",
    event."previousScore",
    event."progressUnit",
    event."progressCurrent",
    event."progressPrevious",
    event."progressTotal",
    event."createdAt",
    event."actorId",
    event."mediaId",
    event."trackingStateId",
    (
        SELECT watchlist."id"
        FROM "Watchlist" AS watchlist
        WHERE watchlist."ownerId" = event."actorId"
          AND watchlist."header" = event."statusLabel"
        ORDER BY watchlist."position", watchlist."id"
        LIMIT 1
    ),
    (
        SELECT watchlist."id"
        FROM "Watchlist" AS watchlist
        WHERE watchlist."ownerId" = event."actorId"
          AND watchlist."header" = event."previousStatusLabel"
        ORDER BY watchlist."position", watchlist."id"
        LIMIT 1
    )
FROM "ActivityEvent" AS event;

DROP TABLE "ActivityEvent";
ALTER TABLE "new_ActivityEvent" RENAME TO "ActivityEvent";

CREATE INDEX "ActivityEvent_actorId_createdAt_idx" ON "ActivityEvent"("actorId", "createdAt");
CREATE INDEX "ActivityEvent_mediaId_createdAt_idx" ON "ActivityEvent"("mediaId", "createdAt");
CREATE INDEX "ActivityEvent_trackingStateId_idx" ON "ActivityEvent"("trackingStateId");
CREATE INDEX "ActivityEvent_statusWatchlistId_idx" ON "ActivityEvent"("statusWatchlistId");
CREATE INDEX "ActivityEvent_previousStatusWatchlistId_idx" ON "ActivityEvent"("previousStatusWatchlistId");
CREATE INDEX "ActivityEvent_isPublic_createdAt_idx" ON "ActivityEvent"("isPublic", "createdAt");
CREATE INDEX "ActivityEvent_type_createdAt_idx" ON "ActivityEvent"("type", "createdAt");

PRAGMA foreign_keys=ON;
