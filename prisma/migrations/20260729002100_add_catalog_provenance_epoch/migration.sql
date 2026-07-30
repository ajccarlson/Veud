ALTER TABLE "Media"
ADD COLUMN "catalogProvenanceVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MediaRelation"
ADD COLUMN "catalogProvenanceVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CatalogMediaMerge"
ADD COLUMN "catalogProvenanceVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Media_catalogProvenanceVersion_id_idx"
ON "Media"("catalogProvenanceVersion", "id");

CREATE INDEX "MediaRelation_source_provenance_type_idx"
ON "MediaRelation"(
    "sourceMediaId",
    "catalogProvenanceVersion",
    "relationType"
);

CREATE INDEX "MediaRelation_provenance_id_idx"
ON "MediaRelation"("catalogProvenanceVersion", "id");

CREATE INDEX "MediaRelation_target_provenance_type_idx"
ON "MediaRelation"(
    "targetMediaId",
    "catalogProvenanceVersion",
    "relationType"
);
