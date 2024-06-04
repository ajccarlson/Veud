/*
  Warnings:

  - Made the column `completionType` on table `ListType` required. This step will fail if there are existing NULL values in that column.
  - Made the column `mediaType` on table `ListType` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ListType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "columns" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "completionType" TEXT NOT NULL
);
INSERT INTO "new_ListType" ("columns", "completionType", "header", "id", "mediaType", "name") SELECT "columns", "completionType", "header", "id", "mediaType", "name" FROM "ListType";
DROP TABLE "ListType";
ALTER TABLE "new_ListType" RENAME TO "ListType";
CREATE UNIQUE INDEX "ListType_name_key" ON "ListType"("name");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
