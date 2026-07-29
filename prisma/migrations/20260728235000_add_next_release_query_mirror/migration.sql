ALTER TABLE "Media" ADD COLUMN "nextReleaseAt" DATETIME;

-- Backfill only payloads accepted by the application parser. json_each()
-- exposes duplicate keys in document order, so selecting the greatest parse
-- id matches JSON.parse() and PostgreSQL JSONB's last-key-wins behavior.
-- Every json_each/json_type call receives a validity-guarded payload so
-- malformed legacy text cannot abort the migration.
WITH "parsed" AS (
    SELECT
        "media"."id",
        (
            SELECT "item"."type"
            FROM json_each(
                CASE
                    WHEN json_valid("media"."nextRelease") = 1
                        THEN "media"."nextRelease"
                    ELSE NULL
                END
            ) AS "item"
            WHERE "item"."key" = 'releaseDate'
            ORDER BY "item"."id" DESC
            LIMIT 1
        ) AS "releaseKind",
        (
            SELECT "item"."value"
            FROM json_each(
                CASE
                    WHEN json_valid("media"."nextRelease") = 1
                        THEN "media"."nextRelease"
                    ELSE NULL
                END
            ) AS "item"
            WHERE "item"."key" = 'releaseDate'
            ORDER BY "item"."id" DESC
            LIMIT 1
        ) AS "releaseValue",
        (
            SELECT "item"."type"
            FROM json_each(
                CASE
                    WHEN json_valid("media"."nextRelease") = 1
                        THEN "media"."nextRelease"
                    ELSE NULL
                END
            ) AS "item"
            WHERE "item"."key" = 'source'
            ORDER BY "item"."id" DESC
            LIMIT 1
        ) AS "sourceKind",
        (
            SELECT "item"."value"
            FROM json_each(
                CASE
                    WHEN json_valid("media"."nextRelease") = 1
                        THEN "media"."nextRelease"
                    ELSE NULL
                END
            ) AS "item"
            WHERE "item"."key" = 'source'
            ORDER BY "item"."id" DESC
            LIMIT 1
        ) AS "sourceValue",
        (
            SELECT "item"."type"
            FROM json_each(
                CASE
                    WHEN json_valid("media"."nextRelease") = 1
                        THEN "media"."nextRelease"
                    ELSE NULL
                END
            ) AS "item"
            WHERE "item"."key" = 'observedAt'
            ORDER BY "item"."id" DESC
            LIMIT 1
        ) AS "observedKind",
        (
            SELECT "item"."value"
            FROM json_each(
                CASE
                    WHEN json_valid("media"."nextRelease") = 1
                        THEN "media"."nextRelease"
                    ELSE NULL
                END
            ) AS "item"
            WHERE "item"."key" = 'observedAt'
            ORDER BY "item"."id" DESC
            LIMIT 1
        ) AS "observedValue"
    FROM "Media" AS "media"
    WHERE "media"."nextRelease" IS NOT NULL
        AND json_type(
            CASE
                WHEN json_valid("media"."nextRelease") = 1
                    THEN "media"."nextRelease"
                ELSE NULL
            END
        ) = 'object'
)
UPDATE "Media"
SET "nextReleaseAt" = (
    SELECT CASE
        WHEN (
            (
                "parsed"."releaseKind" = 'text'
                AND (
                    (
                        length("parsed"."releaseValue") = 10
                        AND "parsed"."releaseValue"
                            GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                        AND substr("parsed"."releaseValue", 1, 4)
                            BETWEEN '0001' AND '9999'
                        AND date(julianday("parsed"."releaseValue"))
                            = "parsed"."releaseValue"
                    )
                    OR (
                        length("parsed"."releaseValue") = 24
                        AND "parsed"."releaseValue"
                            GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                        AND substr("parsed"."releaseValue", 1, 4)
                            BETWEEN '0001' AND '9999'
                        AND strftime(
                            '%Y-%m-%dT%H:%M:%fZ',
                            julianday("parsed"."releaseValue")
                        ) = "parsed"."releaseValue"
                    )
                )
            )
            OR (
                "parsed"."releaseKind" IN ('integer', 'real')
                AND "parsed"."releaseValue"
                    = CAST("parsed"."releaseValue" AS INTEGER)
                AND "parsed"."releaseValue"
                    BETWEEN -62135596800000 AND 253402300799999
            )
        )
        AND (
            (
                "parsed"."sourceKind" IS NULL
                AND "parsed"."observedKind" IS NULL
            )
            OR (
                "parsed"."sourceKind" = 'text'
                AND "parsed"."sourceValue" IN ('anilist', 'tmdb')
                AND "parsed"."observedKind" = 'text'
                AND length("parsed"."observedValue") = 24
                AND "parsed"."observedValue"
                    GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                AND substr("parsed"."observedValue", 1, 4)
                    BETWEEN '0001' AND '9999'
                AND strftime(
                    '%Y-%m-%dT%H:%M:%fZ',
                    julianday("parsed"."observedValue")
                ) = "parsed"."observedValue"
            )
        )
        THEN CASE
            -- Prisma stores SQLite DateTime values as integer epoch
            -- milliseconds. Keeping the mirror in that representation is
            -- required for Date-bound comparisons and client decoding.
            WHEN "parsed"."releaseKind" = 'text'
                AND length("parsed"."releaseValue") = 10
                THEN CAST(strftime(
                    '%s',
                    "parsed"."releaseValue"
                ) AS INTEGER) * 1000
            WHEN "parsed"."releaseKind" = 'text'
                THEN (
                    CAST(strftime(
                        '%s',
                        "parsed"."releaseValue"
                    ) AS INTEGER) * 1000
                    + CAST(substr(
                        "parsed"."releaseValue",
                        21,
                        3
                    ) AS INTEGER)
                )
            ELSE CAST("parsed"."releaseValue" AS INTEGER)
        END
        ELSE NULL
    END
    FROM "parsed"
    WHERE "parsed"."id" = "Media"."id"
)
WHERE "nextRelease" IS NOT NULL;

CREATE INDEX "Media_nextReleaseAt_idx" ON "Media"("nextReleaseAt");
