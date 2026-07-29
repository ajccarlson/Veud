-- Keep this as one statement so Prisma deploy does not wrap CONCURRENTLY.
CREATE INDEX CONCURRENTLY "DiaryEntry_ownerId_loggedOn_createdAt_id_idx"
ON "DiaryEntry"("ownerId", "loggedOn", "createdAt", "id");
