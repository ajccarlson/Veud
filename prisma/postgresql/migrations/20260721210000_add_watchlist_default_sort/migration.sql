ALTER TABLE "Watchlist" ADD COLUMN "defaultSortColumn" TEXT;
ALTER TABLE "Watchlist" ADD COLUMN "defaultSortDirection" TEXT NOT NULL DEFAULT 'asc';
