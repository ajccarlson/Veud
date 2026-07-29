-- Keep this as one statement so Prisma deploy does not wrap CONCURRENTLY.
DROP INDEX CONCURRENTLY IF EXISTS "Review_authorId_createdAt_idx";
