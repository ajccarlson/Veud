ALTER TABLE "LibraryImportItem" ADD COLUMN "aiHypotheses" TEXT;
ALTER TABLE "LibraryImportItem" ADD COLUMN "aiPromptVersion" TEXT;

CREATE TABLE "AiDiscoverySession" (
    "id" TEXT NOT NULL,
    "phrases" TEXT NOT NULL,
    "plans" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "AiDiscoverySession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackingCommandPreview" (
    "id" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "operations" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "journal" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "TrackingCommandPreview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiModerationAssessment" (
    "id" TEXT NOT NULL,
    "categories" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" TEXT NOT NULL,
    "uncertainty" TEXT NOT NULL,
    "recommendedQueue" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportId" TEXT NOT NULL,
    CONSTRAINT "AiModerationAssessment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiDiscoverySession_ownerId_updatedAt_idx" ON "AiDiscoverySession"("ownerId", "updatedAt");
CREATE INDEX "AiDiscoverySession_expiresAt_idx" ON "AiDiscoverySession"("expiresAt");
CREATE INDEX "TrackingCommandPreview_ownerId_status_createdAt_idx" ON "TrackingCommandPreview"("ownerId", "status", "createdAt");
CREATE INDEX "TrackingCommandPreview_expiresAt_idx" ON "TrackingCommandPreview"("expiresAt");
CREATE INDEX "AiModerationAssessment_reportId_createdAt_idx" ON "AiModerationAssessment"("reportId", "createdAt");
CREATE INDEX "AiModerationAssessment_severity_createdAt_idx" ON "AiModerationAssessment"("severity", "createdAt");

ALTER TABLE "AiDiscoverySession" ADD CONSTRAINT "AiDiscoverySession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingCommandPreview" ADD CONSTRAINT "TrackingCommandPreview_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiModerationAssessment" ADD CONSTRAINT "AiModerationAssessment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ModerationReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
