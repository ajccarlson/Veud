-- Keep this as one statement so Prisma deploy does not wrap CONCURRENTLY.
CREATE INDEX CONCURRENTLY "Review_authorId_moderationStatus_createdAt_id_idx"
ON "Review"("authorId", "moderationStatus", "createdAt", "id");
