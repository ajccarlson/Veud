CREATE TABLE "CatalogQualityIssue" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "confidence" DOUBLE PRECISION,
    "summary" TEXT NOT NULL,
    "evidence" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "primaryMediaId" TEXT NOT NULL,
    "secondaryMediaId" TEXT,
    "reviewedById" TEXT,

    CONSTRAINT "CatalogQualityIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogQualityEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "nextStatus" TEXT NOT NULL,
    "note" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issueId" TEXT NOT NULL,
    "actorId" TEXT,

    CONSTRAINT "CatalogQualityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogQualityIssue_fingerprint_key" ON "CatalogQualityIssue"("fingerprint");
CREATE INDEX "CatalogQualityIssue_status_issueType_lastSeenAt_idx" ON "CatalogQualityIssue"("status", "issueType", "lastSeenAt");
CREATE INDEX "CatalogQualityIssue_primaryMediaId_idx" ON "CatalogQualityIssue"("primaryMediaId");
CREATE INDEX "CatalogQualityIssue_secondaryMediaId_idx" ON "CatalogQualityIssue"("secondaryMediaId");
CREATE INDEX "CatalogQualityIssue_reviewedById_idx" ON "CatalogQualityIssue"("reviewedById");
CREATE INDEX "CatalogQualityEvent_issueId_createdAt_idx" ON "CatalogQualityEvent"("issueId", "createdAt");
CREATE INDEX "CatalogQualityEvent_actorId_idx" ON "CatalogQualityEvent"("actorId");

ALTER TABLE "CatalogQualityIssue" ADD CONSTRAINT "CatalogQualityIssue_primaryMediaId_fkey" FOREIGN KEY ("primaryMediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogQualityIssue" ADD CONSTRAINT "CatalogQualityIssue_secondaryMediaId_fkey" FOREIGN KEY ("secondaryMediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogQualityIssue" ADD CONSTRAINT "CatalogQualityIssue_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogQualityEvent" ADD CONSTRAINT "CatalogQualityEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "CatalogQualityIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogQualityEvent" ADD CONSTRAINT "CatalogQualityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
