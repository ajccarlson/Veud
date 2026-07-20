# PostgreSQL cutover evidence and canary gate

Last rehearsed: 2026-07-20 with PostgreSQL 16

This runbook turns the snapshot transfer, representative load test, native
backup/restore drill, and application canary into one target-bound evidence
gate. The gate is read-only: passing it does not change `DATABASE_URL`, start or
stop processes, enable writes, or approve a production cutover by itself.

## Evidence chain

| Evidence            | What binds it to the release                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Transfer checkpoint | Final snapshot SHA-256, destination identity, completed table set, and completion time                         |
| Load report         | Representative row count, throughput, every required query plan/timing, trigram-index use, and concurrent work |
| Backup receipt      | Archive SHA-256 and size, source and disposable restore identities, restore time, migrations, and core counts  |
| Canary report       | Explicit application origin, database-backed healthcheck, public reads, request count, failures, and latency   |
| Approved policy     | Expected targets, freshness windows, minimum counts/throughput, and maximum query/canary latency               |

The final gate report records SHA-256 hashes for the policy and every JSON
artifact plus the snapshot and PostgreSQL archive hashes. Reports and backup
receipts are created mode `0600` and contain no connection credentials.

## Prepare an approved policy

Create an ignored local file such as `postgres-cutover-policy.local.json`.
Values below are illustrative starting points, not approved service-level
objectives. Replace them with budgets and final snapshot counts accepted by the
deployment owner. The gate deliberately rejects the placeholder approver.

```json
{
	"version": 1,
	"approvedBy": "REPLACE_WITH_APPROVER",
	"approvedAt": "2026-07-20T00:00:00.000Z",
	"expectedDatabaseTarget": "db.example.com:5432/veud",
	"expectedCanaryOrigin": "https://canary.example.com",
	"minimumSyntheticRows": 1564333,
	"minimumTransferredTables": 39,
	"minimumInsertRowsPerSecond": 2000,
	"minimumConcurrentSearches": 20,
	"minimumConcurrentUpdateBatches": 5,
	"maximumLoadAgeHours": 168,
	"maximumTransferAgeHours": 24,
	"maximumBackupAgeHours": 4,
	"maximumCanaryAgeHours": 1,
	"maximumConcurrentWallMs": 2000,
	"maximumCanaryP95Ms": 1000,
	"minimumCanaryRequests": 40,
	"minimumCanaryConcurrency": 4,
	"requiredCanaryPaths": [
		"/resources/healthcheck",
		"/",
		"/discover",
		"/credits"
	],
	"requireBackupIdentity": true,
	"maximumQueryExecutionMs": {
		"canonical-title": 150,
		"alternate-title": 150,
		"rare-description": 250,
		"broad-description": 500,
		"no-match": 150,
		"popular-page": 250
	},
	"minimumBackupCounts": {
		"users": 1,
		"watchlists": 1,
		"entries": 1,
		"media": 1,
		"migrations": 1
	}
}
```

`expectedDatabaseTarget` is the credential-free identity printed by the transfer
tooling. `minimumBackupCounts` should come from the verified final SQLite
snapshot inventory, not an estimate. `minimumTransferredTables` is 39 for the
current schema and must move with schema additions. Concurrency floors prevent a
single-request run from satisfying multi-user evidence; required canary paths
prevent a narrow health-only run from passing. `requireBackupIdentity` requires
the restore drill to find the configured `BACKUP_VERIFY_USERNAME` without
recording that username in the receipt. Never lower a budget merely to make a
failed rehearsal pass; record and resolve the reason or obtain an explicit new
approval.

## Build the evidence

### 1. Transfer the final snapshot

Stop writes, create and verify the immutable SQLite snapshot, apply the
PostgreSQL schema to an empty target, and run the transfer described in the
[PostgreSQL operations runbook](postgresql-operations.md). The checkpoint must
end with `status: "completed"`; keep it beside the snapshot.

Repeat the live schema and temporary write/search smoke checks before starting
the canary:

```sh
npm run db:verify:postgres
npm run db:smoke:postgres
```

### 2. Retain the representative load report

Run the current 1,564,333-identity target on production-like staging as
described in the
[PostgreSQL catalog load runbook](postgresql-load-readiness.md). Retain the
initial insertion report—not the idempotent resume report, whose inserted-row
throughput is intentionally zero.

### 3. Create and restore-test a native backup

Configure the primary and clearly disposable restore databases, then run:

```sh
export DATABASE_URL='postgresql://.../veud'
export POSTGRES_BACKUP_VERIFY_URL='postgresql://.../veud_restore'
export BACKUP_VERIFY_USERNAME='<known-account-from-final-snapshot>'
npm run db:backup:postgres
```

After the archive has been fully restored and verified, the command writes
`postgres-<timestamp>.dump.restore-verified.json` beside it. Manually repeating
`npm run db:verify-backup:postgres -- backups/postgres-<timestamp>.dump`
refreshes that receipt. `POSTGRES_BACKUP_RECEIPT` can select another receipt
path for the manual command. Backup retention removes the matching default
receipt whenever it prunes an archive, and a configured offsite archive copy
receives the same hash-valid receipt sidecar.

### 4. Measure the one-process canary

Generate the PostgreSQL Prisma client, build once with the release revision, and
start exactly one canary application process against the transferred database.
Keep general traffic disabled. Preview the public, read-only request set first,
then run it:

```sh
npm run db:canary:postgres -- \
  --base-url https://canary.example.com

npm run db:canary:postgres -- \
  --base-url https://canary.example.com \
  --requests 40 \
  --concurrency 4 \
  --run
```

Remote origins must use HTTPS and cannot contain credentials, paths, query
strings, or fragments. The default request set covers `/resources/healthcheck`,
`/`, `/discover`, and `/credits`. The healthcheck performs a database query and
a self-request; its body must be exactly `OK`. Every response must succeed and
return a body. Use `--paths` only for additional public, read-only routes and
retain the mandatory healthcheck.

The canary command writes its private report even when a request fails, then
exits nonzero so operators retain failure evidence.

## Evaluate the gate

Supply the owner-approved policy and exact artifacts:

```sh
npm run db:cutover:postgres -- \
  --policy postgres-cutover-policy.local.json \
  --transfer-checkpoint backups/data-<timestamp>.db.postgres-transfer.json \
  --snapshot backups/data-<timestamp>.db \
  --load-report test-results/postgres-load-<timestamp>.json \
  --backup backups/postgres-<timestamp>.dump \
  --canary-report test-results/postgres-canary-<timestamp>.json
```

The backup receipt defaults to the sidecar path; override it with
`--backup-receipt` when necessary. A pass requires all artifact hashes and
targets to agree, every artifact to be fresh, every count and throughput floor
to be met, every query to remain within its individual budget, all trigram
indexes to have appeared in the load plans, and every canary request to pass
within the p95 budget.

Store the resulting `test-results/postgres-cutover-<timestamp>.json` with the
release record. It is an evidence manifest, not a cryptographic signature; the
release owner must protect the policy and artifacts through the normal change
approval system.

## Measured local rehearsal

The 2026-07-20 end-to-end rehearsal used a fresh PostgreSQL 16 target and the
verified 24.68 MB SQLite snapshot from the operations rehearsal. Transfer,
schema parity, and temporary application CRUD/search smoke checks passed with
exact counts. The native 6.34 MB PostgreSQL archive restored into a separate
database and produced a matching receipt with 6 users, 35 lists, 5,483 entries,
5,372 media, and the PostgreSQL baseline migration.

One PostgreSQL-backed application process then served 40 read-only requests
across the default canary paths with no failures, 140.062 ms p95, and 175.527 ms
maximum latency. The final local gate passed after binding those artifacts to
the earlier 100,000-identity load report and a rehearsal-only policy.

This proves the operator flow and enforcement behavior, not production approval.
The local policy intentionally required only 100,000 synthetic rows; the
production-like 1,564,333-identity run, real owner approval, representative
traffic, and failure/rollback rehearsal remain mandatory.

## Open writes or roll back

Do not route general traffic or enable writes when any check fails. While the
SQLite snapshot is still the write authority, rollback means stopping the canary
and restoring the previous environment/client selection to that immutable
snapshot.

After PostgreSQL accepts a write, the rollback boundary changes. Veud has no
PostgreSQL-to-SQLite reverse replication, so the old snapshot can no longer be
treated as current. Opening writes therefore requires a separately rehearsed
forward-repair or change-capture/export decision, named incident ownership, and
explicit approval in the maintenance record.

After the observation window, run the complete functional checklist for
authentication, lists, edits/reordering, search, profiles, activity, reviews,
collections, notifications, and catalog workers before declaring the migration
complete.
