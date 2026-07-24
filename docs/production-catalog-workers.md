# Production catalog workers

Veud's local production catalog is maintained by four user-systemd timers:

- daily TMDB and MAL inventory refreshes keep the locally stored provider
  identity set and native popularity signals current;
- resumable TMDB and MAL hydration workers fill and refresh normalized details;
- one non-blocking host lock per provider prevents inventory and hydration from
  consuming the same provider quota concurrently; and
- database leases, checkpoints, provider cooldowns, and per-record retry
  deadlines preserve progress across service restarts.

The workers use `/media/sde/veud-production/config/postgres.env` and an
owner-readable `application.env`. They refuse non-PostgreSQL datasources and
unqualified storage. The MAL workers also refuse committed execution without the
documented operator policy reference.

## Immutable release

Catalog application code never executes from a mutable feature checkout. From an
exact, clean release commit with its PostgreSQL Prisma client already generated,
run:

```sh
ops/local-production/deploy-catalog-release.sh
```

This packages tracked source plus the validated dependency tree under
`/media/sde/veud-production/app/releases/<commit>` and atomically changes the
`app/current` symlink. A `RELEASE` marker binds the worker source to that
commit.

## Installation

Copy the service and timer files from `ops/local-production/systemd` into
`~/.config/systemd/user`, reload user systemd, and enable all four timers. At
production cutover, disable the corresponding staging provider timers first so
the same credentials do not operate two catalog copies.

Hydration defaults intentionally match the reviewed provider-safe pacing:

- MAL is sequential with at least 1,000 ms between requests and a maximum
  100,000 records per kind per pass.
- TMDB allows four concurrent responses, globally spaces request starts by at
  least 100 ms, and hydrates at most 100,000 records per kind per pass.

Environment overrides are namespaced `VEUD_PRODUCTION_*`. Provider `429`
responses stop new requests and persist the upstream deadline; never bypass that
deadline by manually clearing worker state.

## Monitoring and recovery

Run:

```sh
ops/local-production/status.sh
```

The command is read-only. It shows timer/service state, the shared catalog
operations snapshot, and raw available space on both physical filesystems.
`catalog:status` is critical when a running worker has not checkpointed for 15
minutes and degraded for expired leases, recent failures, or material deferred
failure rates.

An expired lease is reclaimed by the next worker. Lease acquisition marks the
stale run abandoned before creating a fresh auditable run. Provider operations
remain idempotent and transactional, so a stopped process may repeat a request
but cannot partially commit a media identity.

The hourly PM2 PostgreSQL backup remains independent of provider workers. Each
backup is restore-tested in a disposable database before its verified archive is
copied to `/media/sdd/veud-production-backups`.
