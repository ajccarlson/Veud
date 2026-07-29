-- Keep this as one statement so Prisma deploy does not wrap CONCURRENTLY.
CREATE INDEX CONCURRENTLY "ActivityEvent_actorId_createdAt_id_idx"
ON "ActivityEvent"("actorId", "createdAt", "id");
