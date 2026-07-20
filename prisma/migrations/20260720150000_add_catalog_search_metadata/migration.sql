ALTER TABLE "Media" ADD COLUMN "catalogPopularity" REAL;
ALTER TABLE "Media" ADD COLUMN "catalogScore" REAL;
ALTER TABLE "Media" ADD COLUMN "releaseStatus" TEXT;

CREATE INDEX "Media_catalogPopularity_idx" ON "Media"("catalogPopularity");
CREATE INDEX "Media_catalogScore_idx" ON "Media"("catalogScore");
CREATE INDEX "Media_releaseStart_idx" ON "Media"("releaseStart");
CREATE INDEX "Media_releaseStatus_idx" ON "Media"("releaseStatus");
CREATE INDEX "Media_title_idx" ON "Media"("title");
