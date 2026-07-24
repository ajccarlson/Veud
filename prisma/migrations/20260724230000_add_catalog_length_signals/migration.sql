ALTER TABLE "Media" ADD COLUMN "runtimeMinutes" INTEGER;
ALTER TABLE "Media" ADD COLUMN "episodeCount" INTEGER;
ALTER TABLE "Media" ADD COLUMN "chapterCount" INTEGER;
ALTER TABLE "Media" ADD COLUMN "volumeCount" INTEGER;

UPDATE "Media"
SET "episodeCount" = CAST("length" AS INTEGER)
WHERE "episodeCount" IS NULL
  AND ("length" LIKE '% ep' OR "length" LIKE '% eps');

UPDATE "Media"
SET "chapterCount" = CAST("chapters" AS INTEGER)
WHERE "chapterCount" IS NULL AND "chapters" GLOB '[0-9]*';

UPDATE "Media"
SET "volumeCount" = CAST("volumes" AS INTEGER)
WHERE "volumeCount" IS NULL AND "volumes" GLOB '[0-9]*';

CREATE INDEX "Media_runtimeMinutes_idx" ON "Media"("runtimeMinutes");
CREATE INDEX "Media_episodeCount_idx" ON "Media"("episodeCount");
CREATE INDEX "Media_chapterCount_idx" ON "Media"("chapterCount");
CREATE INDEX "Media_volumeCount_idx" ON "Media"("volumeCount");
