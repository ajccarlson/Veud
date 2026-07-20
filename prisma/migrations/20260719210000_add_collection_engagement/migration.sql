-- Add collection likes and discussion, then generalize notifications so one
-- inbox can safely point at either review or collection engagement.

CREATE TABLE "CollectionLike" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    CONSTRAINT "CollectionLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionLike_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CollectionComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "authorId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    CONSTRAINT "CollectionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionComment_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reviewId" TEXT,
    "reviewLikeId" TEXT,
    "reviewCommentId" TEXT,
    "collectionId" TEXT,
    "collectionLikeId" TEXT,
    "collectionCommentId" TEXT,
    CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_reviewLikeId_fkey" FOREIGN KEY ("reviewLikeId") REFERENCES "ReviewLike" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_reviewCommentId_fkey" FOREIGN KEY ("reviewCommentId") REFERENCES "ReviewComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_collectionLikeId_fkey" FOREIGN KEY ("collectionLikeId") REFERENCES "CollectionLike" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_collectionCommentId_fkey" FOREIGN KEY ("collectionCommentId") REFERENCES "CollectionComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Notification" ("actorId", "createdAt", "id", "readAt", "recipientId", "reviewCommentId", "reviewId", "reviewLikeId", "type")
SELECT "actorId", "createdAt", "id", "readAt", "recipientId", "reviewCommentId", "reviewId", "reviewLikeId", "type" FROM "Notification";

DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE UNIQUE INDEX "CollectionLike_userId_collectionId_key" ON "CollectionLike"("userId", "collectionId");
CREATE INDEX "CollectionLike_collectionId_createdAt_idx" ON "CollectionLike"("collectionId", "createdAt");
CREATE INDEX "CollectionComment_collectionId_createdAt_idx" ON "CollectionComment"("collectionId", "createdAt");
CREATE INDEX "CollectionComment_authorId_createdAt_idx" ON "CollectionComment"("authorId", "createdAt");
CREATE UNIQUE INDEX "Notification_reviewLikeId_key" ON "Notification"("reviewLikeId");
CREATE UNIQUE INDEX "Notification_reviewCommentId_key" ON "Notification"("reviewCommentId");
CREATE UNIQUE INDEX "Notification_collectionLikeId_key" ON "Notification"("collectionLikeId");
CREATE UNIQUE INDEX "Notification_collectionCommentId_key" ON "Notification"("collectionCommentId");
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");
CREATE INDEX "Notification_reviewId_idx" ON "Notification"("reviewId");
CREATE INDEX "Notification_collectionId_idx" ON "Notification"("collectionId");
