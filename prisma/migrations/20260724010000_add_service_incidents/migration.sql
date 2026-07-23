CREATE TABLE "ServiceIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'minor',
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "affectedAreas" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ServiceIncidentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incidentId" TEXT NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "ServiceIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ServiceIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceIncidentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ServiceIncident_status_startedAt_idx" ON "ServiceIncident"("status", "startedAt");
CREATE INDEX "ServiceIncident_resolvedAt_startedAt_idx" ON "ServiceIncident"("resolvedAt", "startedAt");
CREATE INDEX "ServiceIncidentEvent_incidentId_createdAt_idx" ON "ServiceIncidentEvent"("incidentId", "createdAt");
CREATE INDEX "ServiceIncidentEvent_actorId_createdAt_idx" ON "ServiceIncidentEvent"("actorId", "createdAt");

INSERT OR IGNORE INTO "Permission" ("id", "action", "entity", "access", "description", "createdAt", "updatedAt") VALUES
    ('permission_operations_read_any', 'read', 'operations', 'any', 'View private site operations telemetry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission_operations_update_any', 'update', 'operations', 'any', 'Publish and update public service incidents', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO "Role" ("id", "name", "description", "createdAt", "updatedAt") VALUES
    ('role_site_operator', 'site-operator', 'Site reliability and incident operator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B")
SELECT "id", (SELECT "id" FROM "Role" WHERE "name" = 'site-operator')
FROM "Permission"
WHERE "entity" = 'operations' AND "access" = 'any';

INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B")
SELECT "id", (SELECT "id" FROM "Role" WHERE "name" = 'admin')
FROM "Permission"
WHERE "entity" = 'operations' AND "access" = 'any';
