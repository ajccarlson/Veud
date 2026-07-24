# Local isolated staging

This deployment keeps Veud staging separate from the existing application while
using two distinct local filesystems:

- PostgreSQL runtime, data, releases, cache, and primary backups:
  `/media/sde/veud-staging-postgres`
- restore-verified backup copies: `/media/sdd/veud-staging-backups`

PostgreSQL 16.14 is downloaded from the official PostgreSQL archive, checksum
verified, compiled as the unprivileged account, and bound only to
`127.0.0.1:5433`. The application binds only to `127.0.0.1:4022`. User-level
systemd services refuse to run when the expected live drive is not mounted, and
the backup path additionally requires the second physical filesystem and at
least 50 GiB free.

```sh
ops/local-staging/provision.sh
ops/local-staging/deploy.sh <commit>
ops/local-staging/status.sh
systemctl --user start veud-staging-backup.service
systemctl --user start veud-staging-catalog-backup.service
systemctl --user start veud-staging-mal-hydration.service
systemctl --user start veud-staging-tmdb-hydration.service
systemctl --user start veud-staging-notification-digests.service
```

Secrets live only under `/media/sde/veud-staging-postgres/config` with mode
`0600`. The web process reads only `application.env`; load/restore credentials
remain in `operations.env`, and the PostgreSQL administrator credential remains
in `postgres-admin.env`. Add staging-only provider keys to `application.env`
without copying it into the repository. Generated PostgreSQL URLs must not be
printed or placed in shell history.

When the staging MAL client ID and policy reference are configured, deployment
enables serialized daily inventory refresh and resumable detail hydration
against the qualified catalog database. A separate daily native backup restores
and verifies that catalog database before copying it to the backup drive. MAL
workers share `$STAGING_ROOT/run/mal-provider.lock`, so inventory and hydration
never issue provider requests concurrently.

When `TMDB_API_KEY` is configured, deployment also enables a daily official-ID
inventory and a resumable detail worker against the qualified catalog database.
TMDB workers share `$STAGING_ROOT/run/tmdb-provider.lock`; detail and priority
requests default to four concurrent requests with at least 100 milliseconds
between starts, while each daily pass processes at most 100,000 records per
kind.

When `RESEND_API_KEY` is configured, deployment enables the notification digest
timer. It checks due opt-in accounts every 15 minutes, sends at most one durable
daily or weekly delivery window per member, and does not affect security or
account-verification mail. The command remains a read-only preview unless
`--commit` is explicit.

`ops/local-staging/status.sh` runs the read-only catalog health evaluator
against `STAGING_LOAD_DATABASE_URL`, not the separate public application
database. It reports coverage, queues, failures, and rate limits after checking
the services and HTTPS application dependency. See
[Catalog operations](../../docs/catalog-operations.md) for health thresholds and
machine-readable CLI usage.

For restart-on-boot before an interactive login, an administrator must run the
one-time command `sudo loginctl enable-linger acarl`. This is optional for an
interactive workstation but recommended for an unattended staging origin.

Do not expose ports 4022 or 5433 directly through the router or host firewall.
