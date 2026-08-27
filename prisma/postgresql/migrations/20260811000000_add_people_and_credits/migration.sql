-- A person credited on a title, shared across every title they worked on.
-- Identity comes from the provider's id, never the name.
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "imageUrl" TEXT,
    "knownForDepartment" TEXT,
    "biography" TEXT,
    "birthday" TIMESTAMP(3),
    "deathday" TIMESTAMP(3),
    "placeOfBirth" TEXT,
    "gender" TEXT,
    "homepage" TEXT,
    "detailsFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Person_normalized_idx" ON "Person"("normalized");
CREATE INDEX "Person_name_idx" ON "Person"("name");
-- Lazy biography enrichment picks its next batch by this.
CREATE INDEX "Person_detailsFetchedAt_idx" ON "Person"("detailsFetchedAt");
-- Searching people by name is the same substring problem as titles, over a
-- table that grows faster than the catalog does. Without this, a name query
-- degrades to a sequential scan of every person in the catalog.
CREATE INDEX "Person_normalized_trgm_idx"
    ON "Person" USING GIN ("normalized" gin_trgm_ops);

-- The same human is a TMDB id, a MAL id, and eventually others.
CREATE TABLE "PersonExternalId" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "personId" TEXT NOT NULL,
    CONSTRAINT "PersonExternalId_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonExternalId_provider_externalId_key"
    ON "PersonExternalId"("provider", "externalId");
CREATE INDEX "PersonExternalId_personId_idx" ON "PersonExternalId"("personId");

-- One person's involvement in one title. `role` and `department` default to
-- the empty string rather than NULL so the uniqueness below actually holds:
-- NULL does not compare equal to NULL, which would let every refresh write the
-- same credit again.
CREATE TABLE "MediaCredit" (
    "id" TEXT NOT NULL,
    "creditType" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "billingOrder" INTEGER,
    "episodeCount" INTEGER,
    "provider" TEXT NOT NULL,
    "catalogProvenanceVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mediaId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    CONSTRAINT "MediaCredit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaCredit_mediaId_personId_creditType_role_department_key"
    ON "MediaCredit"("mediaId", "personId", "creditType", "role", "department");
-- Billing order is what "top billed cast" means, so the page reads it in order.
CREATE INDEX "MediaCredit_mediaId_creditType_billingOrder_idx"
    ON "MediaCredit"("mediaId", "creditType", "billingOrder");
CREATE INDEX "MediaCredit_personId_creditType_idx"
    ON "MediaCredit"("personId", "creditType");
CREATE INDEX "MediaCredit_personId_mediaId_idx"
    ON "MediaCredit"("personId", "mediaId");
CREATE INDEX "MediaCredit_provenance_id_idx"
    ON "MediaCredit"("catalogProvenanceVersion", "id");

ALTER TABLE "PersonExternalId" ADD CONSTRAINT "PersonExternalId_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaCredit" ADD CONSTRAINT "MediaCredit_mediaId_fkey"
    FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaCredit" ADD CONSTRAINT "MediaCredit_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
