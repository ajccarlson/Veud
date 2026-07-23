CREATE TABLE "RecommendationFeedback" (
    "id" TEXT NOT NULL,
    "feedbackType" TEXT NOT NULL,
    "sourceLane" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecommendationFeedback_ownerId_mediaId_key" ON "RecommendationFeedback"("ownerId", "mediaId");
CREATE INDEX "RecommendationFeedback_ownerId_feedbackType_updatedAt_idx" ON "RecommendationFeedback"("ownerId", "feedbackType", "updatedAt");
CREATE INDEX "RecommendationFeedback_mediaId_idx" ON "RecommendationFeedback"("mediaId");

ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
