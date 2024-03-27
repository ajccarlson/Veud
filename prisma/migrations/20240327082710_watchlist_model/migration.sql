-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Watchlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "airYear" TEXT,
    "length" TEXT,
    "rating" TEXT,
    "finishedDate" DATETIME,
    "genres" TEXT,
    "language" TEXT,
    "story" INTEGER,
    "character" INTEGER,
    "presentation" INTEGER,
    "sound" INTEGER,
    "performance" INTEGER,
    "enjoyment" INTEGER,
    "averaged" DECIMAL,
    "personal" DECIMAL,
    "differencePersonal" DECIMAL,
    "tmdbScore" DECIMAL,
    "differenceObjective" DECIMAL,
    CONSTRAINT "WatchEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_idx" ON "Watchlist"("ownerId");

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_updatedAt_idx" ON "Watchlist"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "WatchEntry_watchlistId_idx" ON "WatchEntry"("watchlistId");
