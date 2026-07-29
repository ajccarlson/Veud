-- Bound profile analytics keyset scans and the four newest-first activity
-- sources with deterministic id tie-breaks.
CREATE INDEX "Entry_watchlistId_id_idx" ON "Entry"("watchlistId", "id");

CREATE INDEX "ActivityEvent_actorId_createdAt_id_idx"
ON "ActivityEvent"("actorId", "createdAt", "id");
CREATE INDEX "ActivityEvent_actorId_isPublic_publicEligible_createdAt_id_idx"
ON "ActivityEvent"("actorId", "isPublic", "publicEligible", "createdAt", "id");
CREATE INDEX "ActivityEvent_isPublic_publicEligible_createdAt_id_idx"
ON "ActivityEvent"("isPublic", "publicEligible", "createdAt", "id");

CREATE INDEX "Review_authorId_moderationStatus_createdAt_id_idx"
ON "Review"("authorId", "moderationStatus", "createdAt", "id");

CREATE INDEX "DiaryEntry_ownerId_createdAt_id_idx"
ON "DiaryEntry"("ownerId", "createdAt", "id");
CREATE INDEX "DiaryEntry_ownerId_loggedOn_createdAt_id_idx"
ON "DiaryEntry"("ownerId", "loggedOn", "createdAt", "id");

-- Keep every prior access path available until all replacements exist.
DROP INDEX "Entry_watchlistId_idx";
DROP INDEX "ActivityEvent_actorId_createdAt_idx";
DROP INDEX "Review_authorId_createdAt_idx";
DROP INDEX "DiaryEntry_ownerId_loggedOn_idx";
