CREATE TABLE "HomeDashboardPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "density" TEXT NOT NULL DEFAULT 'comfortable',
    "moduleOrder" TEXT NOT NULL,
    "collapsedModules" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "HomeDashboardPreference_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HomeDashboardPreference_ownerId_key" ON "HomeDashboardPreference"("ownerId");
CREATE INDEX "HomeDashboardPreference_updatedAt_idx" ON "HomeDashboardPreference"("updatedAt");
