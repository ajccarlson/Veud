-- Add ordered, public/private curated media collections. These are separate
-- from status watchlists and always point at the canonical Media catalog.

CREATE TABLE "MediaCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "MediaCollection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MediaCollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "collectionId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "MediaCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaCollectionItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MediaCollection_ownerId_updatedAt_idx" ON "MediaCollection"("ownerId", "updatedAt");
CREATE INDEX "MediaCollection_isPublic_updatedAt_idx" ON "MediaCollection"("isPublic", "updatedAt");
CREATE UNIQUE INDEX "MediaCollectionItem_collectionId_mediaId_key" ON "MediaCollectionItem"("collectionId", "mediaId");
CREATE INDEX "MediaCollectionItem_collectionId_position_idx" ON "MediaCollectionItem"("collectionId", "position");
CREATE INDEX "MediaCollectionItem_mediaId_idx" ON "MediaCollectionItem"("mediaId");
