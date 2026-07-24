CREATE TABLE "CatalogMetricSnapshot" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "audience" INTEGER,
    "ratingCount" INTEGER,
    "sourceRank" INTEGER,
    "chartRank" INTEGER,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "CatalogMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogMetricSnapshot_provider_kind_mediaId_observedAt_key" ON "CatalogMetricSnapshot"("provider", "kind", "mediaId", "observedAt");
CREATE INDEX "CatalogMetricSnapshot_provider_kind_observedAt_idx" ON "CatalogMetricSnapshot"("provider", "kind", "observedAt");
CREATE INDEX "CatalogMetricSnapshot_provider_kind_mediaId_observedAt_idx" ON "CatalogMetricSnapshot"("provider", "kind", "mediaId", "observedAt");
CREATE INDEX "CatalogMetricSnapshot_observedAt_idx" ON "CatalogMetricSnapshot"("observedAt");

ALTER TABLE "CatalogMetricSnapshot"
ADD CONSTRAINT "CatalogMetricSnapshot_mediaId_fkey"
FOREIGN KEY ("mediaId") REFERENCES "Media"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
