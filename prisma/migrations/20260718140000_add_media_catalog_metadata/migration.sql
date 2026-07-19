-- Tracking V2, phase 4: promote provider-derived title metadata to Media.
-- Entry remains a compatibility snapshot while reads and new writes transition
-- to the shared catalog record.

-- AlterTable
ALTER TABLE "Media" ADD COLUMN "thumbnail" TEXT;
ALTER TABLE "Media" ADD COLUMN "title" TEXT;
ALTER TABLE "Media" ADD COLUMN "type" TEXT;
ALTER TABLE "Media" ADD COLUMN "releaseStart" DATETIME;
ALTER TABLE "Media" ADD COLUMN "releaseEnd" DATETIME;
ALTER TABLE "Media" ADD COLUMN "nextRelease" TEXT;
ALTER TABLE "Media" ADD COLUMN "genres" TEXT;
ALTER TABLE "Media" ADD COLUMN "description" TEXT;
ALTER TABLE "Media" ADD COLUMN "airYear" TEXT;
ALTER TABLE "Media" ADD COLUMN "startSeason" TEXT;
ALTER TABLE "Media" ADD COLUMN "startYear" TEXT;
ALTER TABLE "Media" ADD COLUMN "length" TEXT;
ALTER TABLE "Media" ADD COLUMN "chapters" TEXT;
ALTER TABLE "Media" ADD COLUMN "volumes" TEXT;
ALTER TABLE "Media" ADD COLUMN "rating" TEXT;
ALTER TABLE "Media" ADD COLUMN "language" TEXT;
ALTER TABLE "Media" ADD COLUMN "studios" TEXT;
ALTER TABLE "Media" ADD COLUMN "serialization" TEXT;
ALTER TABLE "Media" ADD COLUMN "authors" TEXT;
ALTER TABLE "Media" ADD COLUMN "tmdbScore" DECIMAL;
ALTER TABLE "Media" ADD COLUMN "malScore" DECIMAL;

-- Backfill each canonical work from its richest linked Entry snapshot. Keeping
-- every field from the same row avoids assembling contradictory catalog records.
UPDATE "Media"
SET (
    "thumbnail",
    "title",
    "type",
    "releaseStart",
    "releaseEnd",
    "nextRelease",
    "genres",
    "description",
    "airYear",
    "startSeason",
    "startYear",
    "length",
    "chapters",
    "volumes",
    "rating",
    "language",
    "studios",
    "serialization",
    "authors",
    "tmdbScore",
    "malScore"
) = (
    SELECT
        "Entry"."thumbnail",
        "Entry"."title",
        "Entry"."type",
        "Entry"."releaseStart",
        "Entry"."releaseEnd",
        "Entry"."nextRelease",
        "Entry"."genres",
        "Entry"."description",
        "Entry"."airYear",
        "Entry"."startSeason",
        "Entry"."startYear",
        "Entry"."length",
        "Entry"."chapters",
        "Entry"."volumes",
        "Entry"."rating",
        "Entry"."language",
        "Entry"."studios",
        "Entry"."serialization",
        "Entry"."authors",
        "Entry"."tmdbScore",
        "Entry"."malScore"
    FROM "Entry"
    WHERE "Entry"."mediaId" = "Media"."id"
    ORDER BY (
        CASE WHEN "Entry"."thumbnail" IS NOT NULL AND "Entry"."thumbnail" <> '' THEN 4 ELSE 0 END +
        CASE WHEN "Entry"."description" IS NOT NULL AND "Entry"."description" <> '' THEN length("Entry"."description") ELSE 0 END +
        CASE WHEN "Entry"."genres" IS NOT NULL AND "Entry"."genres" <> '' THEN 2 ELSE 0 END +
        CASE WHEN "Entry"."releaseStart" IS NOT NULL THEN 2 ELSE 0 END +
        CASE WHEN COALESCE("Entry"."length", "Entry"."chapters", "Entry"."volumes") IS NOT NULL THEN 2 ELSE 0 END
    ) DESC,
    "Entry"."id" ASC
    LIMIT 1
)
WHERE EXISTS (
    SELECT 1 FROM "Entry" WHERE "Entry"."mediaId" = "Media"."id"
);
