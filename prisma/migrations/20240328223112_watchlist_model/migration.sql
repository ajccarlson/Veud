-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Watchlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveActionEntry" (
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
    "description" TEXT,
    CONSTRAINT "LiveActionEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "startSeason" TEXT,
    "length" TEXT,
    "rating" TEXT,
    "finishedDate" DATETIME,
    "genres" TEXT,
    "studio" TEXT,
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

-- CreateTable
CREATE TABLE "MangaEntry" (
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
    "finishedDate" DATETIME,
    "genres" TEXT,
    "magazine" TEXT,
    "author" TEXT,
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

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_idx" ON "Watchlist"("ownerId");

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_updatedAt_idx" ON "Watchlist"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "LiveActionEntry_watchlistId_idx" ON "LiveActionEntry"("watchlistId");

-- CreateIndex
CREATE INDEX "AnimeEntry_watchlistId_idx" ON "AnimeEntry"("watchlistId");

-- CreateIndex
CREATE INDEX "MangaEntry_watchlistId_idx" ON "MangaEntry"("watchlistId");
