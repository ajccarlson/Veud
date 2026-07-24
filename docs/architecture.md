# Architecture

This document records the boundaries a contributor needs to preserve. Source
code and tests remain the authority for implementation details.

## Application

Veud is a React Router application with server-rendered routes and resource
endpoints. Shared UI lives in `app/components`, route code in `app/routes`, and
server/domain logic in `app/utils`.

The primary data model separates:

- canonical `Media` records and provider identities;
- member-owned watchlists, entries, tracking state, and history; and
- community data such as reviews, collections, follows, and activity.

Provider refreshes may update catalog metadata. They must not overwrite or
delete member-owned data.

## Database schemas

Local development and tests use `prisma/schema.prisma` with SQLite. Production
uses `prisma/postgresql/schema.prisma` and its PostgreSQL migrations.

When changing the data model:

1. update the SQLite schema and migration;
2. run `npm run prisma:postgres:sync-schema`;
3. add the corresponding PostgreSQL migration;
4. run `npm run prisma:postgres:check`; and
5. test both generated clients.

Generate the client appropriate to the target before building:

```sh
npm run prisma:generate:sqlite
npm run prisma:generate:postgres
```

Never point tests, load tests, or restore verification at staging or production.

## Catalog identity

Provider identifiers map to canonical media. Alternate titles and provenance
remain attached to their source. Duplicate resolution must be reversible and
must preserve watchlists, tracking history, reviews, favorites, collections, and
reminders.

Movie and television entries may only enter compatible live-action lists. Anime
and manga follow their corresponding list types. Enforce compatibility on the
server even when the interface already filters choices.

## AI boundary

AI features are optional and controlled by `VEUD_AI_ENABLED` plus
capability-specific switches. Requests go through the shared AI gateway, use
bounded concurrency, and disable provider-side response storage.

AI output is untrusted input. Validate it before using it for catalog queries,
moderation suggestions, imports, or mutations. User-visible mutations require
normal authorization and confirmation paths.

MyAnimeList-derived metadata must never be sent to an external AI provider.

## Authorization

Privacy and role checks belong in server loaders, actions, and resource routes.
Hiding a control is not authorization. Private lists and account data must not
enter public search, feeds, recommendations, or profiles.

Moderation actions are audited. Assigning or revoking moderator privileges
requires the separate role-management permission.

## Runtime layout

- `app/`: application source
- `prisma/`: SQLite schema and migrations
- `prisma/postgresql/`: production schema and migrations
- `scripts/`: maintenance, import, backup, and validation commands
- `ops/local-staging/`: isolated staging services
- `ops/local-production/`: production PostgreSQL and catalog services
- `tests/`: Vitest and Playwright support
