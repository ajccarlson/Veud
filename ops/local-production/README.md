# Local PostgreSQL production operations

These scripts provision Veud's production database and disposable restore
identity inside the existing boot-persistent PostgreSQL 16 service. Production
data, roles, credentials, primary backups, and off-drive backups remain separate
from the staging application and staging catalog databases.

Provisioning and preparation never change `.env`, stop PM2, or open production
writes. The separately guarded environment switch remains an explicit
maintenance-window action after the prepared target and rollback snapshot pass
their gates.

## Provision identities

```sh
npm run production:postgres:provision
```

This creates:

- `veud_production`, owned by `veud_production_app`;
- `veud_production_restore`, owned by `veud_production_restore`;
- mode-`0600` credentials under
  `/media/sde/veud-production/config/postgres.env`;
- primary PostgreSQL backups under `/media/sde/veud-production/backups`; and
- verified off-drive copies under `/media/sdd/veud-production-backups`.

Both databases reject `PUBLIC` connections. The PostgreSQL listener remains
bound to `127.0.0.1:5433`; no database port is exposed through the router or
Cloudflare tunnel.

## Prepare the production target

Use a current, restore-verified custom-format dump from the approved
production-like catalog database:

```sh
npm run production:postgres:prepare -- \
  /path/to/postgres-catalog.dump \
  PREPARE_VEUD_PRODUCTION
```

The typed confirmation protects the destructive `public` schema replacement. The
command validates the archive, restores without source ownership or ACLs,
applies any newer production migrations, rejects schema drift, prints
credential-free core counts, then creates a new production-native backup. That
backup must restore into `veud_production_restore` and copy successfully to the
separate backup filesystem.

Run the read-only status gate at any time:

```sh
npm run production:postgres:status
```

## Write cutover boundary

Before switching the application:

1. Stop general application writes.
2. Take and restore-test the final SQLite snapshot.
3. Confirm its logical content still matches the snapshot that seeded the
   prepared PostgreSQL target.
4. Apply all pending SQLite migrations and retain a second rollback snapshot
   compatible with the release.
5. Atomically select the production database and backup settings:

   ```sh
   npm run production:postgres:switch-environment -- \
     SWITCH_VEUD_PRODUCTION
   ```

   This command accepts only the prepared local production database, changes
   only the allowlisted database and backup keys, and preserves the prior
   mode-`0600` environment as
   `/media/sde/veud-production/config/sqlite-cutover.env`. It also selects an
   existing account identity for every PostgreSQL backup restore check without
   printing that identity or any credentials.

6. Generate the PostgreSQL Prisma client and build the exact `main` release.
7. Restart one PM2 application instance and its provider-aware backup worker.
8. Verify local health, public HTTPS reads, account authentication, list
   mutations, and the fresh PostgreSQL backup/restore receipt.

Once PostgreSQL accepts a user write, SQLite is no longer authoritative.
Incident response is forward repair on PostgreSQL or restore from a verified
PostgreSQL archive; never copy the old SQLite snapshot back over newer
PostgreSQL writes.
