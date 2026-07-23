ALTER TABLE "User" ADD COLUMN "accountStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "User" ADD COLUMN "suspensionEndsAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "accountStatusReason" TEXT;
ALTER TABLE "Notification" ADD COLUMN "message" TEXT;

ALTER TABLE "Review" ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE "Review" ADD COLUMN "moderationReason" TEXT;
ALTER TABLE "Review" ADD COLUMN "moderatedAt" DATETIME;

ALTER TABLE "ReviewComment" ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE "ReviewComment" ADD COLUMN "moderationReason" TEXT;
ALTER TABLE "ReviewComment" ADD COLUMN "moderatedAt" DATETIME;

ALTER TABLE "MediaCollection" ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE "MediaCollection" ADD COLUMN "moderationReason" TEXT;
ALTER TABLE "MediaCollection" ADD COLUMN "moderatedAt" DATETIME;

ALTER TABLE "CollectionComment" ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE "CollectionComment" ADD COLUMN "moderationReason" TEXT;
ALTER TABLE "CollectionComment" ADD COLUMN "moderatedAt" DATETIME;

ALTER TABLE "ProfileComment" ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE "ProfileComment" ADD COLUMN "moderationReason" TEXT;
ALTER TABLE "ProfileComment" ADD COLUMN "moderatedAt" DATETIME;

CREATE TABLE "ModerationReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasonCategory" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "resolutionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "reporterId" TEXT NOT NULL,
    "subjectId" TEXT,
    "assignedToId" TEXT,
    "appealOfActionId" TEXT,
    CONSTRAINT "ModerationReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModerationReport_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModerationReport_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModerationReport_appealOfActionId_fkey" FOREIGN KEY ("appealOfActionId") REFERENCES "ModerationAction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "previousStatus" TEXT,
    "nextStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "subjectId" TEXT,
    "reportId" TEXT,
    CONSTRAINT "ModerationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModerationAction_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModerationAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ModerationReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ModerationAppealDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "details" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    CONSTRAINT "ModerationAppealDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModerationAppealDraft_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ModerationAction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Review_moderationStatus_createdAt_idx" ON "Review"("moderationStatus", "createdAt");
CREATE INDEX "ReviewComment_moderationStatus_createdAt_idx" ON "ReviewComment"("moderationStatus", "createdAt");
CREATE INDEX "MediaCollection_moderationStatus_updatedAt_idx" ON "MediaCollection"("moderationStatus", "updatedAt");
CREATE INDEX "CollectionComment_moderationStatus_createdAt_idx" ON "CollectionComment"("moderationStatus", "createdAt");
CREATE INDEX "ProfileComment_moderationStatus_createdAt_idx" ON "ProfileComment"("moderationStatus", "createdAt");
CREATE INDEX "ModerationReport_status_priority_createdAt_idx" ON "ModerationReport"("status", "priority", "createdAt");
CREATE INDEX "ModerationReport_targetType_targetId_idx" ON "ModerationReport"("targetType", "targetId");
CREATE INDEX "ModerationReport_reporterId_createdAt_idx" ON "ModerationReport"("reporterId", "createdAt");
CREATE INDEX "ModerationReport_subjectId_createdAt_idx" ON "ModerationReport"("subjectId", "createdAt");
CREATE INDEX "ModerationReport_assignedToId_status_idx" ON "ModerationReport"("assignedToId", "status");
CREATE UNIQUE INDEX "ModerationReport_appealOfActionId_key" ON "ModerationReport"("appealOfActionId");
CREATE INDEX "ModerationAction_createdAt_idx" ON "ModerationAction"("createdAt");
CREATE INDEX "ModerationAction_actorId_createdAt_idx" ON "ModerationAction"("actorId", "createdAt");
CREATE INDEX "ModerationAction_subjectId_createdAt_idx" ON "ModerationAction"("subjectId", "createdAt");
CREATE INDEX "ModerationAction_targetType_targetId_createdAt_idx" ON "ModerationAction"("targetType", "targetId", "createdAt");
CREATE INDEX "ModerationAction_reportId_createdAt_idx" ON "ModerationAction"("reportId", "createdAt");
CREATE INDEX "ModerationAppealDraft_userId_createdAt_idx" ON "ModerationAppealDraft"("userId", "createdAt");
CREATE INDEX "ModerationAppealDraft_actionId_createdAt_idx" ON "ModerationAppealDraft"("actionId", "createdAt");
CREATE INDEX "ModerationAppealDraft_expiresAt_idx" ON "ModerationAppealDraft"("expiresAt");

INSERT OR IGNORE INTO "Permission" ("id", "action", "entity", "access", "description", "createdAt", "updatedAt") VALUES
    ('permission_report_create_own', 'create', 'report', 'own', 'Submit community safety reports', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission_report_read_any', 'read', 'report', 'any', 'Review the moderation queue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission_report_update_any', 'update', 'report', 'any', 'Assign and resolve moderation reports', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission_content_moderate_any', 'moderate', 'content', 'any', 'Hide and restore community content', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission_user_moderate_any', 'moderate', 'user', 'any', 'Warn, suspend, and restore member accounts', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission_role_assign_any', 'assign', 'role', 'any', 'Grant and revoke moderator access', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO "Role" ("id", "name", "description", "createdAt", "updatedAt") VALUES
    ('role_moderator', 'moderator', 'Community safety moderator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('role_community_admin', 'community-admin', 'Moderation team administrator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B")
SELECT "id", (SELECT "id" FROM "Role" WHERE "name" = 'user')
FROM "Permission" WHERE "action" = 'create' AND "entity" = 'report' AND "access" = 'own';

INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B")
SELECT "id", (SELECT "id" FROM "Role" WHERE "name" = 'moderator')
FROM "Permission"
WHERE ("action" = 'create' AND "entity" = 'report' AND "access" = 'own')
   OR ("action" = 'read' AND "entity" = 'report' AND "access" = 'any')
   OR ("action" = 'update' AND "entity" = 'report' AND "access" = 'any')
   OR ("action" = 'moderate' AND "entity" IN ('content', 'user') AND "access" = 'any');

INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B")
SELECT "id", (SELECT "id" FROM "Role" WHERE "name" = 'community-admin')
FROM "Permission"
WHERE ("action" = 'create' AND "entity" = 'report' AND "access" = 'own')
   OR ("action" = 'read' AND "entity" = 'report' AND "access" = 'any')
   OR ("action" = 'update' AND "entity" = 'report' AND "access" = 'any')
   OR ("action" = 'moderate' AND "entity" IN ('content', 'user') AND "access" = 'any')
   OR ("action" = 'assign' AND "entity" = 'role' AND "access" = 'any');

INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B")
SELECT "id", (SELECT "id" FROM "Role" WHERE "name" = 'admin')
FROM "Permission"
WHERE ("entity" = 'report')
   OR ("action" = 'moderate' AND "entity" IN ('content', 'user') AND "access" = 'any')
   OR ("action" = 'assign' AND "entity" = 'role' AND "access" = 'any');
