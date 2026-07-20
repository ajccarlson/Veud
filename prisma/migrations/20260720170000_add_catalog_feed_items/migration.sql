CREATE TABLE "CatalogFeedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "feed" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "CatalogFeedItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CatalogFeedItem_provider_kind_feed_mediaId_key" ON "CatalogFeedItem"("provider", "kind", "feed", "mediaId");
CREATE INDEX "CatalogFeedItem_provider_kind_feed_rank_idx" ON "CatalogFeedItem"("provider", "kind", "feed", "rank");
CREATE INDEX "CatalogFeedItem_mediaId_idx" ON "CatalogFeedItem"("mediaId");
CREATE INDEX "CatalogFeedItem_observedAt_idx" ON "CatalogFeedItem"("observedAt");
