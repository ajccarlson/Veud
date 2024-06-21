-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Note_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "columns" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "completionType" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "displayedColumns" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Watchlist_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ListType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Watchlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveActionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "airYear" TEXT,
    "releaseStart" DATETIME,
    "releaseEnd" DATETIME,
    "nextRelease" TEXT,
    "length" TEXT,
    "rating" TEXT,
    "history" TEXT,
    "genres" TEXT,
    "language" TEXT,
    "story" INTEGER,
    "character" INTEGER,
    "presentation" INTEGER,
    "sound" INTEGER,
    "performance" INTEGER,
    "enjoyment" INTEGER,
    "averaged" DECIMAL,
    "personal" DECIMAL,
    "differencePersonal" DECIMAL,
    "tmdbScore" DECIMAL,
    "differenceObjective" DECIMAL,
    "description" TEXT,
    "notes" TEXT,
    CONSTRAINT "LiveActionEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "startSeason" TEXT,
    "releaseStart" DATETIME,
    "releaseEnd" DATETIME,
    "nextRelease" TEXT,
    "length" TEXT,
    "rating" TEXT,
    "history" TEXT,
    "genres" TEXT,
    "studios" TEXT,
    "priority" TEXT,
    "story" INTEGER,
    "character" INTEGER,
    "presentation" INTEGER,
    "sound" INTEGER,
    "performance" INTEGER,
    "enjoyment" INTEGER,
    "averaged" DECIMAL,
    "personal" DECIMAL,
    "differencePersonal" DECIMAL,
    "malScore" DECIMAL,
    "differenceObjective" DECIMAL,
    "description" TEXT,
    "notes" TEXT,
    CONSTRAINT "AnimeEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MangaEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "startYear" TEXT,
    "releaseStart" DATETIME,
    "releaseEnd" DATETIME,
    "nextRelease" TEXT,
    "chapters" TEXT,
    "volumes" TEXT,
    "history" TEXT,
    "genres" TEXT,
    "serialization" TEXT,
    "authors" TEXT,
    "priority" TEXT,
    "story" INTEGER,
    "character" INTEGER,
    "presentation" INTEGER,
    "enjoyment" INTEGER,
    "averaged" DECIMAL,
    "personal" DECIMAL,
    "differencePersonal" DECIMAL,
    "malScore" DECIMAL,
    "differenceObjective" DECIMAL,
    "description" TEXT,
    "notes" TEXT,
    CONSTRAINT "MangaEntry_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserFavorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "mediaType" TEXT,
    "startYear" TEXT,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "UserFavorite_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ListType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserFavorite_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "altText" TEXT,
    "contentType" TEXT NOT NULL,
    "blob" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "noteId" TEXT NOT NULL,
    CONSTRAINT "NoteImage_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "altText" TEXT,
    "contentType" TEXT NOT NULL,
    "blob" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "UserImage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Password" (
    "hash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Password_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKeys" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "access" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expirationDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "digits" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "charSet" TEXT NOT NULL,
    "expiresAt" DATETIME
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerName" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_PermissionToRole" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_PermissionToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_PermissionToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_RoleToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_RoleToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_RoleToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Note_ownerId_idx" ON "Note"("ownerId");

-- CreateIndex
CREATE INDEX "Note_ownerId_updatedAt_idx" ON "Note"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListType_name_key" ON "ListType"("name");

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_idx" ON "Watchlist"("ownerId");

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_updatedAt_idx" ON "Watchlist"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Watchlist_typeId_idx" ON "Watchlist"("typeId");

-- CreateIndex
CREATE INDEX "LiveActionEntry_watchlistId_idx" ON "LiveActionEntry"("watchlistId");

-- CreateIndex
CREATE INDEX "AnimeEntry_watchlistId_idx" ON "AnimeEntry"("watchlistId");

-- CreateIndex
CREATE INDEX "MangaEntry_watchlistId_idx" ON "MangaEntry"("watchlistId");

-- CreateIndex
CREATE INDEX "UserFavorite_typeId_idx" ON "UserFavorite"("typeId");

-- CreateIndex
CREATE INDEX "UserFavorite_ownerId_idx" ON "UserFavorite"("ownerId");

-- CreateIndex
CREATE INDEX "NoteImage_noteId_idx" ON "NoteImage"("noteId");

-- CreateIndex
CREATE UNIQUE INDEX "UserImage_userId_key" ON "UserImage"("userId");

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
CREATE UNIQUE INDEX "_PermissionToRole_AB_unique" ON "_PermissionToRole"("A", "B");

-- CreateIndex
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_RoleToUser_AB_unique" ON "_RoleToUser"("A", "B");

-- CreateIndex
CREATE INDEX "_RoleToUser_B_index" ON "_RoleToUser"("B");

-- SeedTable
INSERT INTO ListType VALUES('yducsgix','liveaction','Live Action','{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","airYear":"string","releaseStart":"date","releaseEnd":"date","length":"string","rating":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","language":"string","story":"number","character":"number","presentation":"number","sound":"number","performance":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","tmdbScore":"number","differenceObjective":"number","description":"string","notes":"string"}','["episode"]','{"present":"watch","past":"watched","continuous":"watching"}');
INSERT INTO ListType VALUES('lx727mrc','anime','Anime','{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","startSeason":"string","releaseStart":"date","releaseEnd":"date","length":"string","rating":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","studios":"string","priority":"string","story":"number","character":"number","presentation":"number","sound":"number","performance":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","malScore":"number","differenceObjective":"number","description":"string","notes":"string"}','["episode"]','{"present":"watch","past":"watched","continuous":"watching"}');
INSERT INTO ListType VALUES('b44evg7f','manga','Manga','{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","startYear":"string","releaseStart":"date","releaseEnd":"date","chapters":"string","volumes":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","serialization":"string","authors":"string","priority":"string","story":"number","character":"number","presentation":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","malScore":"number","differenceObjective":"number","description":"string","notes":"string"}','["chapter","volume"]','{"present":"read","past":"read","continuous":"reading"}');
