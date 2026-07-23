#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
guard_live_storage
guard_backup_storage
load_staging_environment
systemctl --user --no-pager status \
	veud-staging-postgres.service \
	veud-staging-app.service \
	veud-staging-backup.timer \
	veud-staging-catalog-backup.timer \
	veud-staging-mal-inventory.timer \
	veud-staging-mal-hydration.timer || true
printf '\nPostgreSQL: '
"$PG_BIN/psql" "$(postgres_cli_url)" --tuples-only --no-align --command="SELECT current_database() || ' PostgreSQL ' || current_setting('server_version')"
printf 'Application: '
curl --fail --silent --show-error "http://127.0.0.1:4022/resources/healthcheck"
printf '\nLive storage: '
df -h "$LIVE_MOUNT" | tail -1
printf 'Backup storage: '
df -h "$BACKUP_MOUNT" | tail -1
