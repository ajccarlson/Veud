/*
  Warnings:

  - You are about to drop the column `demographics` on the `AnimeEntry` table. All the data in the column will be lost.
  - You are about to drop the column `demographics` on the `MangaEntry` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "startSeason" TEXT,
    "length" TEXT,
    "rating" TEXT,
    "startDate" DATETIME,
    "finishedDate" DATETIME,
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
    CONSTRAINT "AnimeEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnimeEntry" ("averaged", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "finishedDate", "genres", "id", "length", "malScore", "performance", "personal", "position", "presentation", "priority", "rating", "sound", "startDate", "startSeason", "story", "studios", "thumbnail", "title", "type", "watchlistId") SELECT "averaged", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "finishedDate", "genres", "id", "length", "malScore", "performance", "personal", "position", "presentation", "priority", "rating", "sound", "startDate", "startSeason", "story", "studios", "thumbnail", "title", "type", "watchlistId" FROM "AnimeEntry";
DROP TABLE "AnimeEntry";
ALTER TABLE "new_AnimeEntry" RENAME TO "AnimeEntry";
CREATE INDEX "AnimeEntry_watchlistId_idx" ON "AnimeEntry"("watchlistId");
CREATE TABLE "new_MangaEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "startYear" TEXT,
    "chapters" TEXT,
    "volumes" TEXT,
    "rating" TEXT,
    "startDate" DATETIME,
    "finishedDate" DATETIME,
    "genres" TEXT,
    "magazine" TEXT,
    "author" TEXT,
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
    CONSTRAINT "MangaEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MangaEntry" ("author", "averaged", "chapters", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "finishedDate", "genres", "id", "magazine", "malScore", "personal", "position", "presentation", "priority", "rating", "startDate", "startYear", "story", "thumbnail", "title", "type", "volumes", "watchlistId") SELECT "author", "averaged", "chapters", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "finishedDate", "genres", "id", "magazine", "malScore", "personal", "position", "presentation", "priority", "rating", "startDate", "startYear", "story", "thumbnail", "title", "type", "volumes", "watchlistId" FROM "MangaEntry";
DROP TABLE "MangaEntry";
ALTER TABLE "new_MangaEntry" RENAME TO "MangaEntry";
CREATE INDEX "MangaEntry_watchlistId_idx" ON "MangaEntry"("watchlistId");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
