-- Search runs on every page and every query prefix. Keep the prominence value
-- beside the person so that reading it never aggregates the complete credits
-- table. Triggers own the invariant because credits can also disappear through
-- a cascading Media delete, outside the catalog credits writer.
ALTER TABLE "Person" ADD COLUMN "creditCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "Person" AS person
SET "creditCount" = counted.total
FROM (
    SELECT "personId", COUNT(*)::integer AS total
    FROM "MediaCredit"
    GROUP BY "personId"
) AS counted
WHERE person."id" = counted."personId";

CREATE FUNCTION "maintain_person_credit_count"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE "Person"
        SET "creditCount" = "creditCount" + 1
        WHERE "id" = NEW."personId";
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        UPDATE "Person"
        SET "creditCount" = GREATEST("creditCount" - 1, 0)
        WHERE "id" = OLD."personId";
        RETURN OLD;
    END IF;

    -- Reassigning a credit is rare, so recalculate the two affected people
    -- instead of trying to distinguish it from an ON UPDATE CASCADE of the
    -- Person id.
    IF OLD."personId" IS DISTINCT FROM NEW."personId" THEN
        UPDATE "Person"
        SET "creditCount" = (
            SELECT COUNT(*)::integer
            FROM "MediaCredit"
            WHERE "personId" = OLD."personId"
        )
        WHERE "id" = OLD."personId";

        UPDATE "Person"
        SET "creditCount" = (
            SELECT COUNT(*)::integer
            FROM "MediaCredit"
            WHERE "personId" = NEW."personId"
        )
        WHERE "id" = NEW."personId";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "MediaCredit_creditCount_insert"
AFTER INSERT ON "MediaCredit"
FOR EACH ROW EXECUTE FUNCTION "maintain_person_credit_count"();

CREATE TRIGGER "MediaCredit_creditCount_delete"
AFTER DELETE ON "MediaCredit"
FOR EACH ROW EXECUTE FUNCTION "maintain_person_credit_count"();

CREATE TRIGGER "MediaCredit_creditCount_update_person"
AFTER UPDATE OF "personId" ON "MediaCredit"
FOR EACH ROW EXECUTE FUNCTION "maintain_person_credit_count"();
