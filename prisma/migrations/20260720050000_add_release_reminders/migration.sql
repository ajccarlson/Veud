-- Add per-title release reminders and make inbox items schedulable. Reminder
-- notifications are system-authored, so actorId becomes optional while every
-- existing social notification retains its actor and immediate availability.

CREATE TABLE "ReleaseReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    CONSTRAINT "ReleaseReminder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReleaseReminder_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "readAt" DATETIME,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT,
    "reviewId" TEXT,
    "reviewLikeId" TEXT,
    "reviewCommentId" TEXT,
    "collectionId" TEXT,
    "collectionLikeId" TEXT,
    "collectionCommentId" TEXT,
    "releaseReminderId" TEXT,
    CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_reviewLikeId_fkey" FOREIGN KEY ("reviewLikeId") REFERENCES "ReviewLike" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_reviewCommentId_fkey" FOREIGN KEY ("reviewCommentId") REFERENCES "ReviewComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_collectionLikeId_fkey" FOREIGN KEY ("collectionLikeId") REFERENCES "CollectionLike" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_collectionCommentId_fkey" FOREIGN KEY ("collectionCommentId") REFERENCES "CollectionComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_releaseReminderId_fkey" FOREIGN KEY ("releaseReminderId") REFERENCES "ReleaseReminder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Notification" (
    "actorId",
    "availableAt",
    "collectionCommentId",
    "collectionId",
    "collectionLikeId",
    "createdAt",
    "id",
    "readAt",
    "recipientId",
    "reviewCommentId",
    "reviewId",
    "reviewLikeId",
    "type"
)
SELECT
    "actorId",
    "createdAt",
    "collectionCommentId",
    "collectionId",
    "collectionLikeId",
    "createdAt",
    "id",
    "readAt",
    "recipientId",
    "reviewCommentId",
    "reviewId",
    "reviewLikeId",
    "type"
FROM "Notification";

DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE UNIQUE INDEX "ReleaseReminder_ownerId_mediaId_key" ON "ReleaseReminder"("ownerId", "mediaId");
CREATE INDEX "ReleaseReminder_ownerId_updatedAt_idx" ON "ReleaseReminder"("ownerId", "updatedAt");
CREATE INDEX "ReleaseReminder_mediaId_idx" ON "ReleaseReminder"("mediaId");
CREATE UNIQUE INDEX "Notification_reviewLikeId_key" ON "Notification"("reviewLikeId");
CREATE UNIQUE INDEX "Notification_reviewCommentId_key" ON "Notification"("reviewCommentId");
CREATE UNIQUE INDEX "Notification_collectionLikeId_key" ON "Notification"("collectionLikeId");
CREATE UNIQUE INDEX "Notification_collectionCommentId_key" ON "Notification"("collectionCommentId");
CREATE UNIQUE INDEX "Notification_releaseReminderId_releaseAt_key" ON "Notification"("releaseReminderId", "releaseAt");
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");
CREATE INDEX "Notification_recipientId_availableAt_readAt_idx" ON "Notification"("recipientId", "availableAt", "readAt");
CREATE INDEX "Notification_reviewId_idx" ON "Notification"("reviewId");
CREATE INDEX "Notification_collectionId_idx" ON "Notification"("collectionId");
CREATE INDEX "Notification_releaseReminderId_idx" ON "Notification"("releaseReminderId");
