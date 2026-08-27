-- The English title, for anime and manga whose canonical title is romaji.
-- A scalar rather than a lookup through MediaTitle: a title is rendered on
-- every list row and every card, and joining the table that holds every synonym
-- to answer "what do I call this" would put a join on the hottest read.
ALTER TABLE "Media" ADD COLUMN "englishTitle" TEXT;

-- Which title a member sees. On the member rather than in a cookie so it
-- follows them between devices.
ALTER TABLE "User" ADD COLUMN "titleLanguage" TEXT NOT NULL DEFAULT 'default';

-- Backfill from the alternates already stored, so the setting works on the
-- existing catalog rather than only on rows hydrated after this. Hydration
-- writes 'english'; the inventory importer writes 'inventory-english', and the
-- former is preferred where both exist because it comes from the detail
-- payload rather than a ranking row.
UPDATE "Media"
SET "englishTitle" = (
    SELECT "value" FROM "MediaTitle"
    WHERE "MediaTitle"."mediaId" = "Media"."id"
      AND "MediaTitle"."provider" = 'mal'
      AND "MediaTitle"."language" = 'en'
      AND "MediaTitle"."titleType" IN ('english', 'inventory-english')
    ORDER BY CASE "MediaTitle"."titleType" WHEN 'english' THEN 0 ELSE 1 END
    LIMIT 1
)
WHERE "kind" IN ('anime', 'manga');
