DROP INDEX "ModerationReport_status_priority_createdAt_idx";

CREATE INDEX "ModerationReport_status_priority_createdAt_id_idx" ON "ModerationReport"("status", "priority", "createdAt", "id");
CREATE INDEX "ModerationReport_priority_createdAt_id_idx" ON "ModerationReport"("priority", "createdAt", "id");

DROP INDEX "ModerationAction_createdAt_idx";

CREATE INDEX "ModerationAction_createdAt_id_idx" ON "ModerationAction"("createdAt", "id");
