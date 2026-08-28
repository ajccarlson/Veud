-- Keep provider facts and a bounded normalized video list with canonical media.
-- Currency amounts remain decimal strings so large TMDB revenues serialize
-- safely through every JSON route without lossy 32-bit or BigInt coercion.
ALTER TABLE "Media" ADD COLUMN "originalTitle" TEXT;
ALTER TABLE "Media" ADD COLUMN "networks" TEXT;
ALTER TABLE "Media" ADD COLUMN "keywords" TEXT;
ALTER TABLE "Media" ADD COLUMN "budget" TEXT;
ALTER TABLE "Media" ADD COLUMN "revenue" TEXT;
ALTER TABLE "Media" ADD COLUMN "videos" TEXT;
