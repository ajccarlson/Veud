CREATE TABLE "CatalogMediaMerge" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "sourceMediaId" TEXT NOT NULL,
    "targetMediaId" TEXT NOT NULL,
    "preflight" TEXT NOT NULL,
    "preflightFingerprint" TEXT NOT NULL,
    "journal" TEXT,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "issueId" TEXT NOT NULL,
    "preparedById" TEXT,
    "appliedById" TEXT,
    "revertedById" TEXT,

    CONSTRAINT "CatalogMediaMerge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogMediaMergeEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT,
    "nextStatus" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergeId" TEXT NOT NULL,
    "actorId" TEXT,

    CONSTRAINT "CatalogMediaMergeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogMediaMerge_issueId_key" ON "CatalogMediaMerge"("issueId");
CREATE INDEX "CatalogMediaMerge_status_updatedAt_idx" ON "CatalogMediaMerge"("status", "updatedAt");
CREATE INDEX "CatalogMediaMerge_sourceMediaId_idx" ON "CatalogMediaMerge"("sourceMediaId");
CREATE INDEX "CatalogMediaMerge_targetMediaId_idx" ON "CatalogMediaMerge"("targetMediaId");
CREATE INDEX "CatalogMediaMerge_preparedById_idx" ON "CatalogMediaMerge"("preparedById");
CREATE INDEX "CatalogMediaMerge_appliedById_idx" ON "CatalogMediaMerge"("appliedById");
CREATE INDEX "CatalogMediaMerge_revertedById_idx" ON "CatalogMediaMerge"("revertedById");
CREATE INDEX "CatalogMediaMergeEvent_mergeId_createdAt_idx" ON "CatalogMediaMergeEvent"("mergeId", "createdAt");
CREATE INDEX "CatalogMediaMergeEvent_actorId_idx" ON "CatalogMediaMergeEvent"("actorId");

ALTER TABLE "CatalogMediaMerge" ADD CONSTRAINT "CatalogMediaMerge_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "CatalogQualityIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogMediaMerge" ADD CONSTRAINT "CatalogMediaMerge_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogMediaMerge" ADD CONSTRAINT "CatalogMediaMerge_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogMediaMerge" ADD CONSTRAINT "CatalogMediaMerge_revertedById_fkey" FOREIGN KEY ("revertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogMediaMergeEvent" ADD CONSTRAINT "CatalogMediaMergeEvent_mergeId_fkey" FOREIGN KEY ("mergeId") REFERENCES "CatalogMediaMerge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogMediaMergeEvent" ADD CONSTRAINT "CatalogMediaMergeEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
