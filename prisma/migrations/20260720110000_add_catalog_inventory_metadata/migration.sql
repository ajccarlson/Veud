ALTER TABLE "MediaExternalId" ADD COLUMN "sourceTitle" TEXT;
ALTER TABLE "MediaExternalId" ADD COLUMN "sourcePopularity" REAL;
ALTER TABLE "MediaExternalId" ADD COLUMN "sourceIsAdult" BOOLEAN;
ALTER TABLE "MediaExternalId" ADD COLUMN "sourceIsVideo" BOOLEAN;

CREATE INDEX "MediaExternalId_provider_kind_sourcePopularity_idx"
ON "MediaExternalId"("provider", "kind", "sourcePopularity");
