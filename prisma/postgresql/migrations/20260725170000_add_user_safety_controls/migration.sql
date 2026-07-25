CREATE TABLE "UserSafetyControl" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "UserSafetyControl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSafetyControl_ownerId_targetId_kind_key" ON "UserSafetyControl"("ownerId", "targetId", "kind");
CREATE INDEX "UserSafetyControl_ownerId_kind_createdAt_idx" ON "UserSafetyControl"("ownerId", "kind", "createdAt");
CREATE INDEX "UserSafetyControl_targetId_kind_idx" ON "UserSafetyControl"("targetId", "kind");

ALTER TABLE "UserSafetyControl"
ADD CONSTRAINT "UserSafetyControl_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSafetyControl"
ADD CONSTRAINT "UserSafetyControl_targetId_fkey"
FOREIGN KEY ("targetId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
