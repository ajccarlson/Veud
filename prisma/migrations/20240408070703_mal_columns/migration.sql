-- AlterTable
ALTER TABLE "AnimeEntry" ADD COLUMN "demographics" TEXT;
ALTER TABLE "AnimeEntry" ADD COLUMN "priority" TEXT;
ALTER TABLE "AnimeEntry" ADD COLUMN "startDate" DATETIME;

-- AlterTable
ALTER TABLE "MangaEntry" ADD COLUMN "demographics" TEXT;
ALTER TABLE "MangaEntry" ADD COLUMN "priority" TEXT;
ALTER TABLE "MangaEntry" ADD COLUMN "startDate" DATETIME;
