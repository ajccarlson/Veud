-- Keep this as one statement so Prisma deploy does not wrap CONCURRENTLY.
DROP INDEX CONCURRENTLY IF EXISTS "DiaryEntry_ownerId_loggedOn_idx";
