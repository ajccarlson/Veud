-- Fresh deployments need authorization and list-type reference rows before
-- account creation can succeed. Keep this migration idempotent so restored or
-- previously seeded databases retain their existing identifiers.
INSERT OR IGNORE INTO "Permission" (
    "id", "action", "entity", "access", "description", "createdAt", "updatedAt"
) VALUES
    ('permission-user-create-own', 'create', 'user', 'own', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-user-read-own', 'read', 'user', 'own', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-user-update-own', 'update', 'user', 'own', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-user-delete-own', 'delete', 'user', 'own', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-watchlist-create-own', 'create', 'watchlist', 'own', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-watchlist-read-own', 'read', 'watchlist', 'own', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-watchlist-update-own', 'update', 'watchlist', 'own', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-watchlist-delete-own', 'delete', 'watchlist', 'own', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-user-create-any', 'create', 'user', 'any', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-user-read-any', 'read', 'user', 'any', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-user-update-any', 'update', 'user', 'any', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-user-delete-any', 'delete', 'user', 'any', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-watchlist-create-any', 'create', 'watchlist', 'any', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-watchlist-read-any', 'read', 'watchlist', 'any', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-watchlist-update-any', 'update', 'watchlist', 'any', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('permission-watchlist-delete-any', 'delete', 'watchlist', 'any', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO "Role" (
    "id", "name", "description", "createdAt", "updatedAt"
) VALUES
    ('role-user', 'user', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('role-admin', 'admin', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B")
SELECT "Permission"."id", "Role"."id"
FROM "Permission"
CROSS JOIN "Role"
WHERE
    ("Role"."name" = 'user' AND "Permission"."access" = 'own')
    OR ("Role"."name" = 'admin' AND "Permission"."access" = 'any');

INSERT OR IGNORE INTO "ListType" (
    "id", "name", "header", "columns", "mediaType", "completionType"
) VALUES
    (
        'yducsgix',
        'liveaction',
        'Live Action',
        '{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","airYear":"string","releaseStart":"date","releaseEnd":"date","length":"string","rating":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","language":"string","story":"number","character":"number","presentation":"number","sound":"number","performance":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","tmdbScore":"number","differenceObjective":"number","description":"string","notes":"string"}',
        '["episode"]',
        '{"present":"watch","past":"watched","continuous":"watching"}'
    ),
    (
        'lx727mrc',
        'anime',
        'Anime',
        '{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","startSeason":"string","releaseStart":"date","releaseEnd":"date","length":"string","rating":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","studios":"string","priority":"string","story":"number","character":"number","presentation":"number","sound":"number","performance":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","malScore":"number","differenceObjective":"number","description":"string","notes":"string"}',
        '["episode"]',
        '{"present":"watch","past":"watched","continuous":"watching"}'
    ),
    (
        'b44evg7f',
        'manga',
        'Manga',
        '{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","startYear":"string","releaseStart":"date","releaseEnd":"date","chapters":"string","volumes":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","serialization":"string","authors":"string","priority":"string","story":"number","character":"number","presentation":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","malScore":"number","differenceObjective":"number","description":"string","notes":"string"}',
        '["chapter","volume"]',
        '{"present":"read","past":"read","continuous":"reading"}'
    );
