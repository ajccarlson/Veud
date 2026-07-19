-- Add normalized collection tags and per-title curator notes.

ALTER TABLE "MediaCollectionItem" ADD COLUMN "note" TEXT;

CREATE TABLE "CollectionTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL
);

CREATE TABLE "MediaCollectionTag" (
    "collectionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    PRIMARY KEY ("collectionId", "tagId"),
    CONSTRAINT "MediaCollectionTag_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaCollectionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CollectionTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CollectionTag_slug_key" ON "CollectionTag"("slug");
CREATE INDEX "CollectionTag_name_idx" ON "CollectionTag"("name");
CREATE INDEX "MediaCollectionTag_tagId_collectionId_idx" ON "MediaCollectionTag"("tagId", "collectionId");
