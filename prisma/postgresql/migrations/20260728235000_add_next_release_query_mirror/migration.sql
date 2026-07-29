ALTER TABLE "Media" ADD COLUMN "nextReleaseAt" TIMESTAMP(3);

-- PostgreSQL has no exception-free text-to-json/date cast. This temporary
-- migration helper catches malformed legacy values row by row, then is dropped
-- after the one-time backfill.
CREATE FUNCTION "_veud_parse_next_release_at"(payload TEXT)
RETURNS TIMESTAMP(3)
LANGUAGE plpgsql
AS $$
DECLARE
    document JSON;
    release_kind TEXT;
    release_value TEXT;
    source_present BOOLEAN;
    observed_present BOOLEAN;
    observed_at TIMESTAMPTZ;
    parsed_at TIMESTAMPTZ;
    release_millis DOUBLE PRECISION;
BEGIN
    IF payload IS NULL THEN
        RETURN NULL;
    END IF;

    BEGIN
        -- Keep the document in lexical JSON form. JSONB eagerly converts
        -- every numeric token to NUMERIC, so an overwritten out-of-range
        -- duplicate could reject an otherwise valid last-key value before we
        -- inspect it. JSON preserves JSON.parse()'s last-key behavior here.
        document := payload::JSON;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;

    IF json_typeof(document) <> 'object' THEN
        RETURN NULL;
    END IF;

    release_kind := json_typeof(document -> 'releaseDate');
    IF release_kind NOT IN ('string', 'number') THEN
        RETURN NULL;
    END IF;

    source_present := (document -> 'source') IS NOT NULL;
    observed_present := (document -> 'observedAt') IS NOT NULL;
    IF source_present <> observed_present THEN
        RETURN NULL;
    END IF;
    IF source_present THEN
        IF json_typeof(document -> 'source') <> 'string'
            OR document ->> 'source' NOT IN ('anilist', 'tmdb')
            OR json_typeof(document -> 'observedAt') <> 'string'
            OR document ->> 'observedAt'
                !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
            OR substring(document ->> 'observedAt' FROM 1 FOR 4)
                NOT BETWEEN '0001' AND '9999' THEN
            RETURN NULL;
        END IF;
        BEGIN
            observed_at := (document ->> 'observedAt')::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
        IF NOT isfinite(observed_at) THEN
            RETURN NULL;
        END IF;
        IF to_char(
            observed_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) <> document ->> 'observedAt' THEN
            RETURN NULL;
        END IF;
    END IF;

    release_value := document ->> 'releaseDate';
    BEGIN
        IF release_kind = 'number' THEN
            -- JSON.parse() and SQLite both interpret JSON numbers as IEEE-754
            -- doubles. Match that behavior before applying the integer and
            -- supported-range checks.
            release_millis := release_value::DOUBLE PRECISION;
            IF trunc(release_millis) <> release_millis
                OR release_millis < -62135596800000
                OR release_millis > 253402300799999 THEN
                RETURN NULL;
            END IF;
            parsed_at := to_timestamp(release_millis / 1000.0);
        ELSIF release_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            AND substring(release_value FROM 1 FOR 4)
                BETWEEN '0001' AND '9999' THEN
            parsed_at := (release_value || 'T00:00:00Z')::TIMESTAMPTZ;
            IF to_char(parsed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                <> release_value THEN
                RETURN NULL;
            END IF;
        ELSIF release_value
            ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
            AND substring(release_value FROM 1 FOR 4)
                BETWEEN '0001' AND '9999' THEN
            parsed_at := release_value::TIMESTAMPTZ;
            IF to_char(
                parsed_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) <> release_value THEN
                RETURN NULL;
            END IF;
        ELSE
            RETURN NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
    IF NOT isfinite(parsed_at) THEN
        RETURN NULL;
    END IF;

    RETURN (parsed_at AT TIME ZONE 'UTC')::TIMESTAMP(3);
EXCEPTION WHEN OTHERS THEN
    -- PostgreSQL's lexical JSON type can defer some Unicode validation until
    -- an operator reads the document. Keep every such failure isolated to its
    -- legacy row rather than aborting the migration.
    RETURN NULL;
END;
$$;

UPDATE "Media"
SET "nextReleaseAt" = "_veud_parse_next_release_at"("nextRelease")
WHERE "nextRelease" IS NOT NULL;

DROP FUNCTION "_veud_parse_next_release_at"(TEXT);

CREATE INDEX "Media_nextReleaseAt_idx" ON "Media"("nextReleaseAt");
