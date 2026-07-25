CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "fallbackReason" TEXT,
    "status" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUsageEvent_createdAt_idx" ON "AiUsageEvent"("createdAt");
CREATE INDEX "AiUsageEvent_capability_createdAt_idx" ON "AiUsageEvent"("capability", "createdAt");
CREATE INDEX "AiUsageEvent_outcome_createdAt_idx" ON "AiUsageEvent"("outcome", "createdAt");

CREATE TABLE "AiRateLimitBucket" (
    "id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowMs" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiRateLimitBucket_expiresAt_idx" ON "AiRateLimitBucket"("expiresAt");
CREATE INDEX "AiRateLimitBucket_capability_subjectHash_windowStartedAt_idx" ON "AiRateLimitBucket"("capability", "subjectHash", "windowStartedAt");
