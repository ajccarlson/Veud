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
```

Secrets live only under `/media/sde/veud-staging-postgres/config` with mode
`0600`. The web process reads only `application.env`; load/restore credentials
remain in `operations.env`, and the PostgreSQL administrator credential remains
in `postgres-admin.env`. Add staging-only provider keys to `application.env`
without copying it into the repository. Generated PostgreSQL URLs must not be
printed or placed in shell history.

For restart-on-boot before an interactive login, an administrator must run the
one-time command `sudo loginctl enable-linger acarl`. This is optional for an
interactive workstation but recommended for an unattended staging origin.

The Cloudflare tunnel remains a separate manual boundary. Add the public
hostname `staging.veud.net` with service `http://localhost:4022` to the existing
remotely managed tunnel. Do not expose ports 4022 or 5433 through the router or
host firewall.
