/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `ListType` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ListType_name_key" ON "ListType"("name");
