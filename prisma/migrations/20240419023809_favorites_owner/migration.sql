/*
  Warnings:

  - Added the required column `ownerId` to the `UserFavorite` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserFavorite" (
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
INSERT INTO "new_UserFavorite" ("id", "mediaType", "position", "startYear", "thumbnail", "title", "typeId") SELECT "id", "mediaType", "position", "startYear", "thumbnail", "title", "typeId" FROM "UserFavorite";
DROP TABLE "UserFavorite";
ALTER TABLE "new_UserFavorite" RENAME TO "UserFavorite";
CREATE INDEX "UserFavorite_typeId_idx" ON "UserFavorite"("typeId");
CREATE INDEX "UserFavorite_ownerId_idx" ON "UserFavorite"("ownerId");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
