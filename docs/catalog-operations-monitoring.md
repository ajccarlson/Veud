# Catalog operations monitoring

Veud exposes one shared, read-only catalog operations snapshot through:

- the administrator-only `/admin/catalog` route;
- `npm run catalog:status`; and
- `ops/local-staging/status.sh`, which points the command at the isolated
  staging catalog database.

The snapshot reports active and tombstoned provider identities, detail coverage,
freshness, eligible and prioritized queues, deferred failures, lifetime request
and `429` counts, recent sync runs, durable cursors, leases, provider cooldowns,
and a threshold-based health assessment.

## Security and database scope

The web route requires the `admin` role and sends
`Cache-Control: private, no-store`. It provides no worker-start, retry,
lease-clear, reconciliation, or deletion controls. Those remain deliberate
operator actions through the provider runbooks so viewing telemetry cannot
mutate catalog or member data.

The route always describes the database serving that application process.
Isolated local staging intentionally keeps the public application database
separate from the qualified provider-scale catalog database, so its host status
script explicitly sets `DATABASE_URL` to `STAGING_LOAD_DATABASE_URL` before
running the CLI. Do not infer load-database coverage from the public staging
route until datasource cutover is approved.

## Health rules

The current evaluator reports:

- `uninitialized` when no sync runs or durable cursors exist in the selected
  database;
- `critical` when a run still marked `running` has not checkpointed for more
  than 15 minutes;
- `degraded` for an active provider cooldown, a latest job failure within 24
  hours, an expired recorded lease, an inventory completion older than 36 hours,
  an eligible provider/kind queue with no hydration run or cursor, or deferred
  failures at or above the greater of 25 records and 1% of active identities;
  and
- `healthy` when initialized telemetry crosses none of those thresholds.

An actively draining backfill is not unhealthy merely because its coverage is
low or its eligible queue is large. A queue becomes an alert when it has no
durable worker state. Expired leases are warnings because the cooperative lease
protocol can reclaim them safely; a stale running heartbeat is critical because
the run record and worker liveness disagree.

## Operator usage

Read the current datasource:

```sh
npm run catalog:status
```

Produce a machine-readable snapshot:

```sh
npm run catalog:status -- --json
```

The command exits non-zero for `critical` status. Monitoring that also treats
warnings as a failed check can use:

```sh
npm run catalog:status -- --fail-on-degraded
```

On the isolated staging host, use:

```sh
ops/local-staging/status.sh
```

That command also checks PostgreSQL, the application health endpoint, catalog
timers, and both physical storage filesystems. Provider secrets and database
credentials are never included in the snapshot.

Catalog identity and asset findings use the separate
[catalog quality review runbook](catalog-quality-operations.md). The same admin
page displays those findings, but health monitoring remains read-only: quality
scans run from an explicit dry-run-by-default CLI, and administrator decisions
append audit events rather than silently rewriting catalog identities.
