CREATE TABLE "HomeDashboardPreference" (
    "id" TEXT NOT NULL,
    "density" TEXT NOT NULL DEFAULT 'comfortable',
    "moduleOrder" TEXT NOT NULL,
    "collapsedModules" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "HomeDashboardPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeDashboardPreference_ownerId_key" ON "HomeDashboardPreference"("ownerId");
CREATE INDEX "HomeDashboardPreference_updatedAt_idx" ON "HomeDashboardPreference"("updatedAt");

ALTER TABLE "HomeDashboardPreference" ADD CONSTRAINT "HomeDashboardPreference_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
