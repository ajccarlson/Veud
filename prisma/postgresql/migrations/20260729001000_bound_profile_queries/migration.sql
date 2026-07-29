-- Bound profile analytics keyset scans and the four newest-first activity
-- sources with deterministic id tie-breaks.
-- Each PostgreSQL migration in this series contains exactly one statement:
-- Prisma otherwise wraps multi-statement migrations in a transaction, which
-- PostgreSQL forbids for CONCURRENTLY.
-- Bare CREATE is intentional: a failed concurrent build can leave an invalid
-- index, which must fail loudly and be removed before the migration is retried.
CREATE INDEX CONCURRENTLY "Entry_watchlistId_id_idx"
ON "Entry"("watchlistId", "id");
