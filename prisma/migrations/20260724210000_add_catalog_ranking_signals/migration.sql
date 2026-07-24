ALTER TABLE "CatalogFeedItem" ADD COLUMN "audience" INTEGER;
ALTER TABLE "CatalogFeedItem" ADD COLUMN "rankingScore" REAL;
ALTER TABLE "CatalogFeedItem" ADD COLUMN "rankingVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MediaExternalId" ADD COLUMN "sourceRank" INTEGER;
ALTER TABLE "MediaExternalId" ADD COLUMN "sourceAudience" INTEGER;
ALTER TABLE "MediaExternalId" ADD COLUMN "sourceRatingCount" INTEGER;

CREATE INDEX "CatalogFeedItem_provider_kind_feed_observedAt_rankingScore_idx"
ON "CatalogFeedItem"("provider", "kind", "feed", "observedAt", "rankingScore");

WITH "normalized" AS (
    SELECT
        "id",
        1.0 - PERCENT_RANK() OVER (
            PARTITION BY "provider", "kind", "feed"
            ORDER BY "rank" ASC
        ) AS "rankScore"
    FROM "CatalogFeedItem"
)
UPDATE "CatalogFeedItem"
SET "rankingScore" = (
        SELECT "rankScore"
        FROM "normalized"
        WHERE "normalized"."id" = "CatalogFeedItem"."id"
    ),
    "rankingVersion" = 1
WHERE "id" IN (SELECT "id" FROM "normalized");
