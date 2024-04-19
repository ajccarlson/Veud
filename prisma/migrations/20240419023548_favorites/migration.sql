-- CreateTable
CREATE TABLE "UserFavorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "title" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "mediaType" TEXT,
    "startYear" TEXT,
    CONSTRAINT "UserFavorite_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ListType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserFavorite_typeId_idx" ON "UserFavorite"("typeId");
