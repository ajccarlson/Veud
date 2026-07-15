-- Unify the three entry tables (LiveActionEntry, AnimeEntry, MangaEntry) into a single
-- `Entry` table whose columns are the union of the three. Media-type-specific columns are
-- nullable and simply left NULL for rows whose source table lacked them.
--
-- This migration is data-preserving: it creates the new table, copies every existing row
-- from each legacy table, and only then drops the legacy tables. On a fresh database (e.g.
-- the test DB) the source tables are empty, so the copy is a no-op.

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "releaseStart" DATETIME,
    "releaseEnd" DATETIME,
    "nextRelease" TEXT,
    "history" TEXT,
    "genres" TEXT,
    "story" INTEGER,
    "character" INTEGER,
    "presentation" INTEGER,
    "enjoyment" INTEGER,
    "averaged" DECIMAL,
    "personal" DECIMAL,
    "differencePersonal" DECIMAL,
    "differenceObjective" DECIMAL,
    "description" TEXT,
    "notes" TEXT,
    "airYear" TEXT,
    "startSeason" TEXT,
    "startYear" TEXT,
    "length" TEXT,
    "chapters" TEXT,
    "volumes" TEXT,
    "rating" TEXT,
    "language" TEXT,
    "studios" TEXT,
    "serialization" TEXT,
    "authors" TEXT,
    "priority" TEXT,
    "sound" INTEGER,
    "performance" INTEGER,
    "tmdbScore" DECIMAL,
    "malScore" DECIMAL,
    CONSTRAINT "Entry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Entry_watchlistId_idx" ON "Entry"("watchlistId");

-- CopyData: LiveActionEntry -> Entry
INSERT INTO "Entry" ("id", "watchlistId", "position", "thumbnail", "title", "type", "airYear", "releaseStart", "releaseEnd", "nextRelease", "length", "rating", "history", "genres", "language", "story", "character", "presentation", "sound", "performance", "enjoyment", "averaged", "personal", "differencePersonal", "tmdbScore", "differenceObjective", "description", "notes")
SELECT "id", "watchlistId", "position", "thumbnail", "title", "type", "airYear", "releaseStart", "releaseEnd", "nextRelease", "length", "rating", "history", "genres", "language", "story", "character", "presentation", "sound", "performance", "enjoyment", "averaged", "personal", "differencePersonal", "tmdbScore", "differenceObjective", "description", "notes" FROM "LiveActionEntry";

-- CopyData: AnimeEntry -> Entry
INSERT INTO "Entry" ("id", "watchlistId", "position", "thumbnail", "title", "type", "startSeason", "releaseStart", "releaseEnd", "nextRelease", "length", "rating", "history", "genres", "studios", "priority", "story", "character", "presentation", "sound", "performance", "enjoyment", "averaged", "personal", "differencePersonal", "malScore", "differenceObjective", "description", "notes")
SELECT "id", "watchlistId", "position", "thumbnail", "title", "type", "startSeason", "releaseStart", "releaseEnd", "nextRelease", "length", "rating", "history", "genres", "studios", "priority", "story", "character", "presentation", "sound", "performance", "enjoyment", "averaged", "personal", "differencePersonal", "malScore", "differenceObjective", "description", "notes" FROM "AnimeEntry";

-- CopyData: MangaEntry -> Entry
INSERT INTO "Entry" ("id", "watchlistId", "position", "thumbnail", "title", "type", "startYear", "releaseStart", "releaseEnd", "nextRelease", "chapters", "volumes", "history", "genres", "serialization", "authors", "priority", "story", "character", "presentation", "enjoyment", "averaged", "personal", "differencePersonal", "malScore", "differenceObjective", "description", "notes")
SELECT "id", "watchlistId", "position", "thumbnail", "title", "type", "startYear", "releaseStart", "releaseEnd", "nextRelease", "chapters", "volumes", "history", "genres", "serialization", "authors", "priority", "story", "character", "presentation", "enjoyment", "averaged", "personal", "differencePersonal", "malScore", "differenceObjective", "description", "notes" FROM "MangaEntry";

-- DropTable
DROP TABLE "LiveActionEntry";
DROP TABLE "AnimeEntry";
DROP TABLE "MangaEntry";
