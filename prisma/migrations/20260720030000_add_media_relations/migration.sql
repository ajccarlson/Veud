-- CreateTable
CREATE TABLE "MediaRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "relationType" TEXT NOT NULL,
    "provider" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceMediaId" TEXT NOT NULL,
    "targetMediaId" TEXT NOT NULL,
    CONSTRAINT "MediaRelation_sourceMediaId_fkey" FOREIGN KEY ("sourceMediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaRelation_targetMediaId_fkey" FOREIGN KEY ("targetMediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaRelation_sourceMediaId_targetMediaId_relationType_key" ON "MediaRelation"("sourceMediaId", "targetMediaId", "relationType");

-- CreateIndex
CREATE INDEX "MediaRelation_sourceMediaId_relationType_idx" ON "MediaRelation"("sourceMediaId", "relationType");

-- CreateIndex
CREATE INDEX "MediaRelation_targetMediaId_relationType_idx" ON "MediaRelation"("targetMediaId", "relationType");

-- CreateIndex
CREATE INDEX "MediaRelation_provider_idx" ON "MediaRelation"("provider");
