/*
  Warnings:

  - You are about to drop the column `columns` on the `Watchlist` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Watchlist` table. All the data in the column will be lost.
  - Added the required column `typeId` to the `Watchlist` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "ListType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "columns" TEXT NOT NULL
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "displayedColumns" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Watchlist_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ListType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Watchlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Watchlist" ("createdAt", "description", "displayedColumns", "header", "id", "name", "ownerId", "position", "updatedAt") SELECT "createdAt", "description", "displayedColumns", "header", "id", "name", "ownerId", "position", "updatedAt" FROM "Watchlist";
DROP TABLE "Watchlist";
ALTER TABLE "new_Watchlist" RENAME TO "Watchlist";
CREATE INDEX "Watchlist_ownerId_idx" ON "Watchlist"("ownerId");
CREATE INDEX "Watchlist_ownerId_updatedAt_idx" ON "Watchlist"("ownerId", "updatedAt");
CREATE INDEX "Watchlist_typeId_idx" ON "Watchlist"("typeId");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
