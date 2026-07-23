CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "inAppSocial" BOOLEAN NOT NULL DEFAULT true,
    "inAppReleases" BOOLEAN NOT NULL DEFAULT true,
    "emailSocial" BOOLEAN NOT NULL DEFAULT false,
    "emailReleases" BOOLEAN NOT NULL DEFAULT false,
    "digestFrequency" TEXT NOT NULL DEFAULT 'off',
    "digestHour" INTEGER NOT NULL DEFAULT 9,
    "digestWeekday" INTEGER NOT NULL DEFAULT 1,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "nextDigestAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDigest" (
    "id" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "NotificationDigest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_ownerId_key" ON "NotificationPreference"("ownerId");
CREATE INDEX "NotificationPreference_nextDigestAt_idx" ON "NotificationPreference"("nextDigestAt");
CREATE UNIQUE INDEX "NotificationDigest_ownerId_windowStart_windowEnd_key" ON "NotificationDigest"("ownerId", "windowStart", "windowEnd");
CREATE INDEX "NotificationDigest_status_createdAt_idx" ON "NotificationDigest"("status", "createdAt");
CREATE INDEX "NotificationDigest_ownerId_createdAt_idx" ON "NotificationDigest"("ownerId", "createdAt");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDigest" ADD CONSTRAINT "NotificationDigest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
