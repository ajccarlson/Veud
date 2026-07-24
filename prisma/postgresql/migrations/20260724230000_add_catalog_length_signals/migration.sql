ALTER TABLE "Media"
  ADD COLUMN "runtimeMinutes" INTEGER,
  ADD COLUMN "episodeCount" INTEGER,
  ADD COLUMN "chapterCount" INTEGER,
  ADD COLUMN "volumeCount" INTEGER;

UPDATE "Media"
SET "episodeCount" = NULLIF(SUBSTRING("length" FROM '^[0-9]+'), '')::INTEGER
WHERE "episodeCount" IS NULL
  AND "length" ~ '^[0-9]+ eps?$';

UPDATE "Media"
SET "chapterCount" = "chapters"::INTEGER
WHERE "chapterCount" IS NULL AND "chapters" ~ '^[0-9]+$';

UPDATE "Media"
SET "volumeCount" = "volumes"::INTEGER
WHERE "volumeCount" IS NULL AND "volumes" ~ '^[0-9]+$';

CREATE INDEX "Media_runtimeMinutes_idx" ON "Media"("runtimeMinutes");
CREATE INDEX "Media_episodeCount_idx" ON "Media"("episodeCount");
CREATE INDEX "Media_chapterCount_idx" ON "Media"("chapterCount");
CREATE INDEX "Media_volumeCount_idx" ON "Media"("volumeCount");
