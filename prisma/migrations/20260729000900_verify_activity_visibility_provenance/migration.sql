-- Historical ActivityEvent rows cannot always be attributed to a watchlist:
-- older rows used mutable labels and a previous migration could only guess when
-- duplicate labels existed. Keep those rows owner-visible, but require all new
-- public activity to opt into immutable, public-at-creation eligibility.
ALTER TABLE "ActivityEvent"
ADD COLUMN "publicEligible" BOOLEAN NOT NULL DEFAULT false;
