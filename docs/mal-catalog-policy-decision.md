# MAL catalog policy decision

Decision date: 2026-07-22

Decision reference: `OWNER-MAL-API-AGREEMENT-2026-07-22`

## Authorization basis

Veud's deployment owner authorized server-side ingestion and redisplay of
non-user MyAnimeList catalog metadata under the existing MAL API agreement. This
is an owner policy interpretation, not separate written approval issued by
MyAnimeList, and the audit reference must never describe it as provider-issued
approval.

The authorization distinguishes MAL-curated media metadata from user-generated
content. Veud may ingest MAL-curated anime and manga metadata and properties
made available through the official API. It must not ingest MAL reviews,
community or forum posts, user profiles, user lists, credentials, or other
personal or user-originated content.

## Required controls

- Use only the official MAL API with Veud's registered client; never scrape MAL
  HTML or substitute an unofficial API to expand coverage.
- Preserve visible MAL attribution and links to the corresponding source title.
- Keep provider identity and provenance on every imported catalog identity.
- Honor a MAL correction or removal request within 24 hours by correcting or
  tombstoning the provider identity without deleting member-owned tracking,
  history, reviews, favorites, or collections.
- Keep requests sequential and respect provider cooldown and rate-limit signals.
- Never send MAL-sourced metadata to OpenAI or another external AI/ML provider.
  Local deterministic search and recommendation processing remains permitted.
- Reassess the agreement and obtain any additionally required authorization
  before commercializing Veud or materially expanding the authorized use.

## Operational reference

Committed inventory and hydration jobs must use the non-secret reference
`OWNER-MAL-API-AGREEMENT-2026-07-22` through `MAL_CATALOG_POLICY_APPROVAL_REF`
or `--policy-approval-ref`. The reference may be committed to `CatalogSyncRun`;
credentials and private correspondence may not be placed in that field.

This decision clears the policy-reference portion of the ingestion gate. It does
not clear the separate PostgreSQL staging, backup/restore, load, canary, or
cutover gates.
