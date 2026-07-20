-- Required by the provider-scale title and description substring indexes below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "columns" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "completionType" TEXT NOT NULL,

    CONSTRAINT "ListType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "displayedColumns" TEXT,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT,
    "type" TEXT,
    "releaseStart" TIMESTAMP(3),
    "releaseEnd" TIMESTAMP(3),
    "nextRelease" TEXT,
    "genres" TEXT,
    "description" TEXT,
    "airYear" TEXT,
    "startSeason" TEXT,
    "startYear" TEXT,
    "length" TEXT,
    "chapters" TEXT,
    "volumes" TEXT,
    "rating" TEXT,
    "language" TEXT,
    "studios" TEXT,
    "serialization" TEXT,
    "authors" TEXT,
    "tmdbScore" DECIMAL(65,30),
    "malScore" DECIMAL(65,30),
    "catalogScore" DOUBLE PRECISION,
    "catalogPopularity" DOUBLE PRECISION,
    "releaseStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogFeedItem" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "feed" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "CatalogFeedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaExternalId" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceTitle" TEXT,
    "sourcePopularity" DOUBLE PRECISION,
    "sourceIsAdult" BOOLEAN,
    "sourceIsVideo" BOOLEAN,
    "hydrationPriority" INTEGER NOT NULL DEFAULT 0,
    "hydrationReason" TEXT,
    "hydrationRequestedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFetchedAt" TIMESTAMP(3),
    "refreshAfter" TIMESTAMP(3),
    "tombstonedAt" TIMESTAMP(3),
    "fetchStatus" TEXT NOT NULL DEFAULT 'pending',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "MediaExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaTitle" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT '',
    "titleType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "MediaTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaRelation" (
    "id" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceMediaId" TEXT NOT NULL,
    "targetMediaId" TEXT NOT NULL,

    CONSTRAINT "MediaRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSyncRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "leaseOwner" TEXT NOT NULL,
    "cursor" TEXT,
    "recordsSeen" INTEGER NOT NULL DEFAULT 0,
    "recordsHandled" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "requestsMade" INTEGER NOT NULL DEFAULT 0,
    "rateLimitEvents" INTEGER NOT NULL DEFAULT 0,
    "providerRetryAfter" TIMESTAMP(3),
    "policyApprovalRef" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSyncCursor" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "cursor" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "mediaId" TEXT,
    "trackingStateId" TEXT,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "releaseStart" TIMESTAMP(3),
    "releaseEnd" TIMESTAMP(3),
    "nextRelease" TEXT,
    "history" TEXT,
    "genres" TEXT,
    "story" INTEGER,
    "character" INTEGER,
    "presentation" INTEGER,
    "enjoyment" INTEGER,
    "averaged" DECIMAL(65,30),
    "personal" DECIMAL(65,30),
    "differencePersonal" DECIMAL(65,30),
    "differenceObjective" DECIMAL(65,30),
    "description" TEXT,
    "notes" TEXT,
    "airYear" TEXT,
    "startSeason" TEXT,
    "startYear" TEXT,
    "length" TEXT,
    "chapters" TEXT,
    "volumes" TEXT,
    "rating" TEXT,
    "language" TEXT,
    "studios" TEXT,
    "serialization" TEXT,
    "authors" TEXT,
    "priority" TEXT,
    "sound" INTEGER,
    "performance" INTEGER,
    "tmdbScore" DECIMAL(65,30),
    "malScore" DECIMAL(65,30),

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingState" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DECIMAL(65,30),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "repeatCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "statusWatchlistId" TEXT,

    CONSTRAINT "TrackingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingProgress" (
    "id" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "trackingStateId" TEXT NOT NULL,

    CONSTRAINT "TrackingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "statusLabel" TEXT,
    "previousStatus" TEXT,
    "previousStatusLabel" TEXT,
    "score" DECIMAL(65,30),
    "previousScore" DECIMAL(65,30),
    "progressUnit" TEXT,
    "progressCurrent" INTEGER,
    "progressPrevious" INTEGER,
    "progressTotal" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "trackingStateId" TEXT,
    "statusWatchlistId" TEXT,
    "previousStatusWatchlistId" TEXT,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "containsSpoilers" BOOLEAN NOT NULL DEFAULT false,
    "rating" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLike" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,

    CONSTRAINT "ReviewLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewComment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "ReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseReminder" (
    "id" TEXT NOT NULL,
    "leadMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "ReleaseReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT,
    "reviewId" TEXT,
    "reviewLikeId" TEXT,
    "reviewCommentId" TEXT,
    "collectionId" TEXT,
    "collectionLikeId" TEXT,
    "collectionCommentId" TEXT,
    "releaseReminderId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiaryEntry" (
    "id" TEXT NOT NULL,
    "loggedOn" TIMESTAMP(3) NOT NULL,
    "isRepeat" BOOLEAN NOT NULL DEFAULT false,
    "rating" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "DiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaCollection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "featuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "MediaCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaCollectionItem" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "collectionId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "MediaCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "CollectionTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaCollectionTag" (
    "collectionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "MediaCollectionTag_pkey" PRIMARY KEY ("collectionId","tagId")
);

-- CreateTable
CREATE TABLE "CollectionLike" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,

    CONSTRAINT "CollectionLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionComment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,

    CONSTRAINT "CollectionComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFavorite" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "mediaType" TEXT,
    "startYear" TEXT,
    "ownerId" TEXT NOT NULL,
    "mediaId" TEXT,

    CONSTRAINT "UserFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserImage" (
    "id" TEXT NOT NULL,
    "altText" TEXT,
    "contentType" TEXT NOT NULL,
    "blob" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBanner" (
    "id" TEXT NOT NULL,
    "altText" TEXT,
    "contentType" TEXT NOT NULL,
    "blob" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Password" (
    "hash" TEXT NOT NULL,
    "userId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "digits" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "charSet" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileComment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,

    CONSTRAINT "ProfileComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PermissionToRole" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_RoleToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ListType_name_key" ON "ListType"("name");

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_idx" ON "Watchlist"("ownerId");

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_updatedAt_idx" ON "Watchlist"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_isPublic_idx" ON "Watchlist"("ownerId", "isPublic");

-- CreateIndex
CREATE INDEX "Watchlist_typeId_idx" ON "Watchlist"("typeId");

-- CreateIndex
CREATE INDEX "Media_kind_idx" ON "Media"("kind");

-- CreateIndex
CREATE INDEX "Media_catalogPopularity_idx" ON "Media"("catalogPopularity");

-- CreateIndex
CREATE INDEX "Media_catalogScore_idx" ON "Media"("catalogScore");

-- CreateIndex
CREATE INDEX "Media_releaseStart_idx" ON "Media"("releaseStart");

-- CreateIndex
CREATE INDEX "Media_releaseStatus_idx" ON "Media"("releaseStatus");

-- CreateIndex
CREATE INDEX "Media_title_idx" ON "Media"("title");

-- CreateIndex
CREATE INDEX "Media_title_trgm_idx" ON "Media" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Media_description_trgm_idx" ON "Media" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "CatalogFeedItem_provider_kind_feed_rank_idx" ON "CatalogFeedItem"("provider", "kind", "feed", "rank");

-- CreateIndex
CREATE INDEX "CatalogFeedItem_mediaId_idx" ON "CatalogFeedItem"("mediaId");

-- CreateIndex
CREATE INDEX "CatalogFeedItem_observedAt_idx" ON "CatalogFeedItem"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogFeedItem_provider_kind_feed_mediaId_key" ON "CatalogFeedItem"("provider", "kind", "feed", "mediaId");

-- CreateIndex
CREATE INDEX "MediaExternalId_mediaId_idx" ON "MediaExternalId"("mediaId");

-- CreateIndex
CREATE INDEX "MediaExternalId_provider_kind_fetchStatus_refreshAfter_idx" ON "MediaExternalId"("provider", "kind", "fetchStatus", "refreshAfter");

-- CreateIndex
CREATE INDEX "MediaExternalId_provider_kind_hydrationPriority_sourcePopul_idx" ON "MediaExternalId"("provider", "kind", "hydrationPriority", "sourcePopularity");

-- CreateIndex
CREATE INDEX "MediaExternalId_provider_kind_sourcePopularity_idx" ON "MediaExternalId"("provider", "kind", "sourcePopularity");

-- CreateIndex
CREATE INDEX "MediaExternalId_provider_kind_lastSeenAt_idx" ON "MediaExternalId"("provider", "kind", "lastSeenAt");

-- CreateIndex
CREATE INDEX "MediaExternalId_tombstonedAt_idx" ON "MediaExternalId"("tombstonedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaExternalId_provider_kind_externalId_key" ON "MediaExternalId"("provider", "kind", "externalId");

-- CreateIndex
CREATE INDEX "MediaTitle_mediaId_provider_idx" ON "MediaTitle"("mediaId", "provider");

-- CreateIndex
CREATE INDEX "MediaTitle_normalized_idx" ON "MediaTitle"("normalized");

-- CreateIndex
CREATE INDEX "MediaTitle_normalized_trgm_idx" ON "MediaTitle" USING GIN ("normalized" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "MediaTitle_mediaId_provider_language_titleType_value_key" ON "MediaTitle"("mediaId", "provider", "language", "titleType", "value");

-- CreateIndex
CREATE INDEX "MediaRelation_sourceMediaId_relationType_idx" ON "MediaRelation"("sourceMediaId", "relationType");

-- CreateIndex
CREATE INDEX "MediaRelation_targetMediaId_relationType_idx" ON "MediaRelation"("targetMediaId", "relationType");

-- CreateIndex
CREATE INDEX "MediaRelation_provider_idx" ON "MediaRelation"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRelation_sourceMediaId_targetMediaId_relationType_key" ON "MediaRelation"("sourceMediaId", "targetMediaId", "relationType");

-- CreateIndex
CREATE INDEX "CatalogSyncRun_provider_kind_mode_startedAt_idx" ON "CatalogSyncRun"("provider", "kind", "mode", "startedAt");

-- CreateIndex
CREATE INDEX "CatalogSyncRun_status_heartbeatAt_idx" ON "CatalogSyncRun"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "CatalogSyncCursor_leaseExpiresAt_idx" ON "CatalogSyncCursor"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSyncCursor_provider_kind_mode_key" ON "CatalogSyncCursor"("provider", "kind", "mode");

-- CreateIndex
CREATE INDEX "Entry_watchlistId_idx" ON "Entry"("watchlistId");

-- CreateIndex
CREATE INDEX "Entry_mediaId_idx" ON "Entry"("mediaId");

-- CreateIndex
CREATE INDEX "Entry_trackingStateId_idx" ON "Entry"("trackingStateId");

-- CreateIndex
CREATE INDEX "TrackingState_mediaId_idx" ON "TrackingState"("mediaId");

-- CreateIndex
CREATE INDEX "TrackingState_statusWatchlistId_idx" ON "TrackingState"("statusWatchlistId");

-- CreateIndex
CREATE INDEX "TrackingState_ownerId_status_idx" ON "TrackingState"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingState_ownerId_mediaId_key" ON "TrackingState"("ownerId", "mediaId");

-- CreateIndex
CREATE INDEX "TrackingProgress_trackingStateId_idx" ON "TrackingProgress"("trackingStateId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingProgress_trackingStateId_unit_key" ON "TrackingProgress"("trackingStateId", "unit");

-- CreateIndex
CREATE INDEX "ActivityEvent_actorId_createdAt_idx" ON "ActivityEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_mediaId_createdAt_idx" ON "ActivityEvent"("mediaId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_trackingStateId_idx" ON "ActivityEvent"("trackingStateId");

-- CreateIndex
CREATE INDEX "ActivityEvent_statusWatchlistId_idx" ON "ActivityEvent"("statusWatchlistId");

-- CreateIndex
CREATE INDEX "ActivityEvent_previousStatusWatchlistId_idx" ON "ActivityEvent"("previousStatusWatchlistId");

-- CreateIndex
CREATE INDEX "ActivityEvent_isPublic_createdAt_idx" ON "ActivityEvent"("isPublic", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_type_createdAt_idx" ON "ActivityEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Review_authorId_createdAt_idx" ON "Review"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_mediaId_createdAt_idx" ON "Review"("mediaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_authorId_mediaId_key" ON "Review"("authorId", "mediaId");

-- CreateIndex
CREATE INDEX "ReviewLike_reviewId_createdAt_idx" ON "ReviewLike"("reviewId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewLike_userId_reviewId_key" ON "ReviewLike"("userId", "reviewId");

-- CreateIndex
CREATE INDEX "ReviewComment_reviewId_createdAt_idx" ON "ReviewComment"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewComment_authorId_createdAt_idx" ON "ReviewComment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewComment_parentId_idx" ON "ReviewComment"("parentId");

-- CreateIndex
CREATE INDEX "ReleaseReminder_ownerId_updatedAt_idx" ON "ReleaseReminder"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "ReleaseReminder_mediaId_idx" ON "ReleaseReminder"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseReminder_ownerId_mediaId_key" ON "ReleaseReminder"("ownerId", "mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_reviewLikeId_key" ON "Notification"("reviewLikeId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_reviewCommentId_key" ON "Notification"("reviewCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_collectionLikeId_key" ON "Notification"("collectionLikeId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_collectionCommentId_key" ON "Notification"("collectionCommentId");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_availableAt_readAt_idx" ON "Notification"("recipientId", "availableAt", "readAt");

-- CreateIndex
CREATE INDEX "Notification_reviewId_idx" ON "Notification"("reviewId");

-- CreateIndex
CREATE INDEX "Notification_collectionId_idx" ON "Notification"("collectionId");

-- CreateIndex
CREATE INDEX "Notification_releaseReminderId_idx" ON "Notification"("releaseReminderId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_releaseReminderId_releaseAt_key" ON "Notification"("releaseReminderId", "releaseAt");

-- CreateIndex
CREATE INDEX "DiaryEntry_ownerId_loggedOn_idx" ON "DiaryEntry"("ownerId", "loggedOn");

-- CreateIndex
CREATE INDEX "DiaryEntry_mediaId_loggedOn_idx" ON "DiaryEntry"("mediaId", "loggedOn");

-- CreateIndex
CREATE INDEX "MediaCollection_ownerId_updatedAt_idx" ON "MediaCollection"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "MediaCollection_isPublic_updatedAt_idx" ON "MediaCollection"("isPublic", "updatedAt");

-- CreateIndex
CREATE INDEX "MediaCollection_featuredAt_idx" ON "MediaCollection"("featuredAt");

-- CreateIndex
CREATE INDEX "MediaCollectionItem_collectionId_position_idx" ON "MediaCollectionItem"("collectionId", "position");

-- CreateIndex
CREATE INDEX "MediaCollectionItem_mediaId_idx" ON "MediaCollectionItem"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaCollectionItem_collectionId_mediaId_key" ON "MediaCollectionItem"("collectionId", "mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTag_slug_key" ON "CollectionTag"("slug");

-- CreateIndex
CREATE INDEX "CollectionTag_name_idx" ON "CollectionTag"("name");

-- CreateIndex
CREATE INDEX "MediaCollectionTag_tagId_collectionId_idx" ON "MediaCollectionTag"("tagId", "collectionId");

-- CreateIndex
CREATE INDEX "CollectionLike_collectionId_createdAt_idx" ON "CollectionLike"("collectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionLike_userId_collectionId_key" ON "CollectionLike"("userId", "collectionId");

-- CreateIndex
CREATE INDEX "CollectionComment_collectionId_createdAt_idx" ON "CollectionComment"("collectionId", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionComment_authorId_createdAt_idx" ON "CollectionComment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "UserFavorite_typeId_idx" ON "UserFavorite"("typeId");

-- CreateIndex
CREATE INDEX "UserFavorite_ownerId_idx" ON "UserFavorite"("ownerId");

-- CreateIndex
CREATE INDEX "UserFavorite_mediaId_idx" ON "UserFavorite"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "UserImage_userId_key" ON "UserImage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBanner_userId_key" ON "UserBanner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Password_userId_key" ON "Password"("userId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_action_entity_access_key" ON "Permission"("action", "entity", "access");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_target_type_key" ON "Verification"("target", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_providerName_providerId_key" ON "Connection"("providerName", "providerId");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "ProfileComment_authorId_idx" ON "ProfileComment"("authorId");

-- CreateIndex
CREATE INDEX "ProfileComment_profileId_createdAt_idx" ON "ProfileComment"("profileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "_PermissionToRole_AB_unique" ON "_PermissionToRole"("A", "B");

-- CreateIndex
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_RoleToUser_AB_unique" ON "_RoleToUser"("A", "B");

-- CreateIndex
CREATE INDEX "_RoleToUser_B_index" ON "_RoleToUser"("B");

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ListType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogFeedItem" ADD CONSTRAINT "CatalogFeedItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaExternalId" ADD CONSTRAINT "MediaExternalId_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTitle" ADD CONSTRAINT "MediaTitle_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelation" ADD CONSTRAINT "MediaRelation_sourceMediaId_fkey" FOREIGN KEY ("sourceMediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelation" ADD CONSTRAINT "MediaRelation_targetMediaId_fkey" FOREIGN KEY ("targetMediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_trackingStateId_fkey" FOREIGN KEY ("trackingStateId") REFERENCES "TrackingState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingState" ADD CONSTRAINT "TrackingState_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingState" ADD CONSTRAINT "TrackingState_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingState" ADD CONSTRAINT "TrackingState_statusWatchlistId_fkey" FOREIGN KEY ("statusWatchlistId") REFERENCES "Watchlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingProgress" ADD CONSTRAINT "TrackingProgress_trackingStateId_fkey" FOREIGN KEY ("trackingStateId") REFERENCES "TrackingState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_trackingStateId_fkey" FOREIGN KEY ("trackingStateId") REFERENCES "TrackingState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_statusWatchlistId_fkey" FOREIGN KEY ("statusWatchlistId") REFERENCES "Watchlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_previousStatusWatchlistId_fkey" FOREIGN KEY ("previousStatusWatchlistId") REFERENCES "Watchlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLike" ADD CONSTRAINT "ReviewLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLike" ADD CONSTRAINT "ReviewLike_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ReviewComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseReminder" ADD CONSTRAINT "ReleaseReminder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseReminder" ADD CONSTRAINT "ReleaseReminder_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reviewLikeId_fkey" FOREIGN KEY ("reviewLikeId") REFERENCES "ReviewLike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reviewCommentId_fkey" FOREIGN KEY ("reviewCommentId") REFERENCES "ReviewComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_collectionLikeId_fkey" FOREIGN KEY ("collectionLikeId") REFERENCES "CollectionLike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_collectionCommentId_fkey" FOREIGN KEY ("collectionCommentId") REFERENCES "CollectionComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_releaseReminderId_fkey" FOREIGN KEY ("releaseReminderId") REFERENCES "ReleaseReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiaryEntry" ADD CONSTRAINT "DiaryEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiaryEntry" ADD CONSTRAINT "DiaryEntry_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCollection" ADD CONSTRAINT "MediaCollection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCollectionItem" ADD CONSTRAINT "MediaCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCollectionItem" ADD CONSTRAINT "MediaCollectionItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCollectionTag" ADD CONSTRAINT "MediaCollectionTag_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCollectionTag" ADD CONSTRAINT "MediaCollectionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CollectionTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionLike" ADD CONSTRAINT "CollectionLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionLike" ADD CONSTRAINT "CollectionLike_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionComment" ADD CONSTRAINT "CollectionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionComment" ADD CONSTRAINT "CollectionComment_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MediaCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ListType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserImage" ADD CONSTRAINT "UserImage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBanner" ADD CONSTRAINT "UserBanner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Password" ADD CONSTRAINT "Password_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileComment" ADD CONSTRAINT "ProfileComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileComment" ADD CONSTRAINT "ProfileComment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PermissionToRole" ADD CONSTRAINT "_PermissionToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PermissionToRole" ADD CONSTRAINT "_PermissionToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
