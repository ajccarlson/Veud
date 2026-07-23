CREATE TABLE "ServiceIncident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'minor',
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "affectedAreas" TEXT NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceIncident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceIncidentEvent" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incidentId" TEXT NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "ServiceIncidentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceIncident_status_startedAt_idx" ON "ServiceIncident"("status", "startedAt");
CREATE INDEX "ServiceIncident_resolvedAt_startedAt_idx" ON "ServiceIncident"("resolvedAt", "startedAt");
CREATE INDEX "ServiceIncidentEvent_incidentId_createdAt_idx" ON "ServiceIncidentEvent"("incidentId", "createdAt");
CREATE INDEX "ServiceIncidentEvent_actorId_createdAt_idx" ON "ServiceIncidentEvent"("actorId", "createdAt");

ALTER TABLE "ServiceIncidentEvent" ADD CONSTRAINT "ServiceIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ServiceIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceIncidentEvent" ADD CONSTRAINT "ServiceIncidentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "action", "entity", "access", "description", "createdAt", "updatedAt") VALUES
    ('permission_operations_read_any', 'read', 'operations', 'any', 'View private site operations telemetry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission_operations_update_any', 'update', 'operations', 'any', 'Publish and update public service incidents', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("action", "entity", "access") DO NOTHING;

INSERT INTO "Role" ("id", "name", "description", "createdAt", "updatedAt") VALUES
    ('role_site_operator', 'site-operator', 'Site reliability and incident operator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT "id", (SELECT "id" FROM "Role" WHERE "name" = 'site-operator')
FROM "Permission"
WHERE "entity" = 'operations' AND "access" = 'any'
ON CONFLICT DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT "id", (SELECT "id" FROM "Role" WHERE "name" = 'admin')
FROM "Permission"
WHERE "entity" = 'operations' AND "access" = 'any'
ON CONFLICT DO NOTHING;
