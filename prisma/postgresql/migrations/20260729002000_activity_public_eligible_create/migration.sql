-- Keep this as one statement so Prisma deploy does not wrap CONCURRENTLY.
CREATE INDEX CONCURRENTLY "ActivityEvent_isPublic_publicEligible_createdAt_id_idx"
ON "ActivityEvent"("isPublic", "publicEligible", "createdAt", "id");
