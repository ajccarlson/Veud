ALTER TABLE "MediaExternalId" ADD COLUMN "hydrationPriority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MediaExternalId" ADD COLUMN "hydrationReason" TEXT;
ALTER TABLE "MediaExternalId" ADD COLUMN "hydrationRequestedAt" DATETIME;

ALTER TABLE "CatalogSyncRun" ADD COLUMN "requestsMade" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CatalogSyncRun" ADD COLUMN "rateLimitEvents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CatalogSyncRun" ADD COLUMN "providerRetryAfter" DATETIME;

CREATE INDEX "MediaExternalId_provider_kind_hydrationPriority_sourcePopularity_idx"
ON "MediaExternalId"("provider", "kind", "hydrationPriority", "sourcePopularity");
