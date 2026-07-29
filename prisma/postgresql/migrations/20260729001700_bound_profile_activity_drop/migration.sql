-- Keep this as one statement so Prisma deploy does not wrap CONCURRENTLY.
DROP INDEX CONCURRENTLY IF EXISTS "ActivityEvent_actorId_createdAt_idx";
