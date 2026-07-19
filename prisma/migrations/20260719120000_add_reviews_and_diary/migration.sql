-- Add first-class reviews and repeatable diary logs to canonical media.

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "containsSpoilers" BOOLEAN NOT NULL DEFAULT false,
    "rating" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "authorId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiaryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loggedOn" DATETIME NOT NULL,
    "isRepeat" BOOLEAN NOT NULL DEFAULT false,
    "rating" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "DiaryEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiaryEntry_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_authorId_mediaId_key" ON "Review"("authorId", "mediaId");

-- CreateIndex
CREATE INDEX "Review_authorId_createdAt_idx" ON "Review"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_mediaId_createdAt_idx" ON "Review"("mediaId", "createdAt");

-- CreateIndex
CREATE INDEX "DiaryEntry_ownerId_loggedOn_idx" ON "DiaryEntry"("ownerId", "loggedOn");

-- CreateIndex
CREATE INDEX "DiaryEntry_mediaId_loggedOn_idx" ON "DiaryEntry"("mediaId", "loggedOn");
