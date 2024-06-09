/*
  Warnings:

  - You are about to drop the column `nextChapter` on the `MangaEntry` table. All the data in the column will be lost.
  - You are about to drop the column `nextEpisode` on the `AnimeEntry` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MangaEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "startYear" TEXT,
    "publishInfo" TEXT,
    "chapters" TEXT,
    "volumes" TEXT,
    "history" TEXT,
    "genres" TEXT,
    "serialization" TEXT,
    "authors" TEXT,
    "priority" TEXT,
    "story" INTEGER,
    "character" INTEGER,
    "presentation" INTEGER,
    "enjoyment" INTEGER,
    "averaged" DECIMAL,
    "personal" DECIMAL,
    "differencePersonal" DECIMAL,
    "malScore" DECIMAL,
    "differenceObjective" DECIMAL,
    "description" TEXT,
    "notes" TEXT,
    CONSTRAINT "MangaEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MangaEntry" ("authors", "averaged", "chapters", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "genres", "history", "id", "malScore", "notes", "personal", "position", "presentation", "priority", "serialization", "startYear", "story", "thumbnail", "title", "type", "volumes", "watchlistId") SELECT "authors", "averaged", "chapters", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "genres", "history", "id", "malScore", "notes", "personal", "position", "presentation", "priority", "serialization", "startYear", "story", "thumbnail", "title", "type", "volumes", "watchlistId" FROM "MangaEntry";
DROP TABLE "MangaEntry";
ALTER TABLE "new_MangaEntry" RENAME TO "MangaEntry";
CREATE INDEX "MangaEntry_watchlistId_idx" ON "MangaEntry"("watchlistId");
CREATE TABLE "new_AnimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "startSeason" TEXT,
    "airInfo" TEXT,
    "length" TEXT,
    "rating" TEXT,
    "history" TEXT,
    "genres" TEXT,
    "studios" TEXT,
    "priority" TEXT,
    "story" INTEGER,
    "character" INTEGER,
    "presentation" INTEGER,
    "sound" INTEGER,
    "performance" INTEGER,
    "enjoyment" INTEGER,
    "averaged" DECIMAL,
    "personal" DECIMAL,
    "differencePersonal" DECIMAL,
    "malScore" DECIMAL,
    "differenceObjective" DECIMAL,
    "description" TEXT,
    "notes" TEXT,
    CONSTRAINT "AnimeEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnimeEntry" ("averaged", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "genres", "history", "id", "length", "malScore", "notes", "performance", "personal", "position", "presentation", "priority", "rating", "sound", "startSeason", "story", "studios", "thumbnail", "title", "type", "watchlistId") SELECT "averaged", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "genres", "history", "id", "length", "malScore", "notes", "performance", "personal", "position", "presentation", "priority", "rating", "sound", "startSeason", "story", "studios", "thumbnail", "title", "type", "watchlistId" FROM "AnimeEntry";
DROP TABLE "AnimeEntry";
ALTER TABLE "new_AnimeEntry" RENAME TO "AnimeEntry";
CREATE INDEX "AnimeEntry_watchlistId_idx" ON "AnimeEntry"("watchlistId");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
