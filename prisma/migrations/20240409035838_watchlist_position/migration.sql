-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL DEFAULT -1,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "columns" TEXT,
    "hiddenColumns" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Watchlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Watchlist" ("columns", "createdAt", "description", "header", "hiddenColumns", "id", "name", "ownerId", "type", "updatedAt") SELECT "columns", "createdAt", "description", "header", "hiddenColumns", "id", "name", "ownerId", "type", "updatedAt" FROM "Watchlist";
DROP TABLE "Watchlist";
ALTER TABLE "new_Watchlist" RENAME TO "Watchlist";
CREATE UNIQUE INDEX "Watchlist_position_key" ON "Watchlist"("position");
CREATE INDEX "Watchlist_ownerId_idx" ON "Watchlist"("ownerId");
CREATE INDEX "Watchlist_ownerId_updatedAt_idx" ON "Watchlist"("ownerId", "updatedAt");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
