/*
  Warnings:

  - You are about to drop the column `studio` on the `AnimeEntry` table. All the data in the column will be lost.

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
    "demographics" TEXT,
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
INSERT INTO "new_AnimeEntry" ("averaged", "character", "demographics", "description", "differenceObjective", "differencePersonal", "enjoyment", "finishedDate", "genres", "id", "length", "malScore", "performance", "personal", "position", "presentation", "priority", "rating", "sound", "startDate", "startSeason", "story", "thumbnail", "title", "type", "watchlistId") SELECT "averaged", "character", "demographics", "description", "differenceObjective", "differencePersonal", "enjoyment", "finishedDate", "genres", "id", "length", "malScore", "performance", "personal", "position", "presentation", "priority", "rating", "sound", "startDate", "startSeason", "story", "thumbnail", "title", "type", "watchlistId" FROM "AnimeEntry";
DROP TABLE "AnimeEntry";
ALTER TABLE "new_AnimeEntry" RENAME TO "AnimeEntry";
CREATE INDEX "AnimeEntry_watchlistId_idx" ON "AnimeEntry"("watchlistId");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
