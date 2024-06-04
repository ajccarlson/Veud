/*
  Warnings:

  - You are about to drop the column `author` on the `MangaEntry` table. All the data in the column will be lost.

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
    "chapters" TEXT,
    "volumes" TEXT,
    "rating" TEXT,
    "startDate" DATETIME,
    "finishedDate" DATETIME,
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
    CONSTRAINT "MangaEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MangaEntry" ("averaged", "chapters", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "finishedDate", "genres", "id", "malScore", "personal", "position", "presentation", "priority", "rating", "serialization", "startDate", "startYear", "story", "thumbnail", "title", "type", "volumes", "watchlistId") SELECT "averaged", "chapters", "character", "description", "differenceObjective", "differencePersonal", "enjoyment", "finishedDate", "genres", "id", "malScore", "personal", "position", "presentation", "priority", "rating", "serialization", "startDate", "startYear", "story", "thumbnail", "title", "type", "volumes", "watchlistId" FROM "MangaEntry";
DROP TABLE "MangaEntry";
ALTER TABLE "new_MangaEntry" RENAME TO "MangaEntry";
CREATE INDEX "MangaEntry_watchlistId_idx" ON "MangaEntry"("watchlistId");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
