CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capability" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "fallbackReason" TEXT,
    "status" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AiUsageEvent_createdAt_idx" ON "AiUsageEvent"("createdAt");
CREATE INDEX "AiUsageEvent_capability_createdAt_idx" ON "AiUsageEvent"("capability", "createdAt");
CREATE INDEX "AiUsageEvent_outcome_createdAt_idx" ON "AiUsageEvent"("outcome", "createdAt");

CREATE TABLE "AiRateLimitBucket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capability" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "windowStartedAt" DATETIME NOT NULL,
    "windowMs" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "AiRateLimitBucket_expiresAt_idx" ON "AiRateLimitBucket"("expiresAt");
CREATE INDEX "AiRateLimitBucket_capability_subjectHash_windowStartedAt_idx" ON "AiRateLimitBucket"("capability", "subjectHash", "windowStartedAt");
