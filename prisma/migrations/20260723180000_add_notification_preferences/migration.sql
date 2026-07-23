CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inAppSocial" BOOLEAN NOT NULL DEFAULT true,
    "inAppReleases" BOOLEAN NOT NULL DEFAULT true,
    "emailSocial" BOOLEAN NOT NULL DEFAULT false,
    "emailReleases" BOOLEAN NOT NULL DEFAULT false,
    "digestFrequency" TEXT NOT NULL DEFAULT 'off',
    "digestHour" INTEGER NOT NULL DEFAULT 9,
    "digestWeekday" INTEGER NOT NULL DEFAULT 1,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "nextDigestAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "NotificationPreference_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationDigest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "frequency" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "NotificationDigest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationPreference_ownerId_key" ON "NotificationPreference"("ownerId");
CREATE INDEX "NotificationPreference_nextDigestAt_idx" ON "NotificationPreference"("nextDigestAt");
CREATE UNIQUE INDEX "NotificationDigest_ownerId_windowStart_windowEnd_key" ON "NotificationDigest"("ownerId", "windowStart", "windowEnd");
CREATE INDEX "NotificationDigest_status_createdAt_idx" ON "NotificationDigest"("status", "createdAt");
CREATE INDEX "NotificationDigest_ownerId_createdAt_idx" ON "NotificationDigest"("ownerId", "createdAt");
