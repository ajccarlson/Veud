-- Search runs on every page and every query prefix. Keep the prominence value
-- beside the person so that reading it never aggregates the complete credits
-- table. Triggers own the invariant because credits can also disappear through
-- a cascading Media delete, outside the catalog credits writer.
ALTER TABLE "Person" ADD COLUMN "creditCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "Person"
SET "creditCount" = (
    SELECT COUNT(*)
    FROM "MediaCredit"
    WHERE "MediaCredit"."personId" = "Person"."id"
);

CREATE TRIGGER "MediaCredit_creditCount_insert"
AFTER INSERT ON "MediaCredit"
BEGIN
    UPDATE "Person"
    SET "creditCount" = "creditCount" + 1
    WHERE "id" = NEW."personId";
END;

CREATE TRIGGER "MediaCredit_creditCount_delete"
AFTER DELETE ON "MediaCredit"
BEGIN
    UPDATE "Person"
    SET "creditCount" = MAX("creditCount" - 1, 0)
    WHERE "id" = OLD."personId";
END;

-- Reassigning a credit is rare, so recalculate the two affected people instead
-- of trying to distinguish it from an ON UPDATE CASCADE of the Person id.
CREATE TRIGGER "MediaCredit_creditCount_update_person"
AFTER UPDATE OF "personId" ON "MediaCredit"
WHEN OLD."personId" <> NEW."personId"
BEGIN
    UPDATE "Person"
    SET "creditCount" = (
        SELECT COUNT(*) FROM "MediaCredit"
        WHERE "personId" = OLD."personId"
    )
    WHERE "id" = OLD."personId";

    UPDATE "Person"
    SET "creditCount" = (
        SELECT COUNT(*) FROM "MediaCredit"
        WHERE "personId" = NEW."personId"
    )
    WHERE "id" = NEW."personId";
END;
