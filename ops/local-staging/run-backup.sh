#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
guard_live_storage
guard_backup_storage
load_staging_environment
verify_node_22
assert_staging_operations_database_identities
acquire_staging_writer_lifetime_lock_shared
verify_active_staging_release
assert_staging_catalog_cutover_role backup
release_root="$STAGING_ROOT/app/current"
[[ -f "$release_root/scripts/backup-database.mjs" ]] ||
	die 'The selected staging release cannot run application backups'
export BACKUP_SOURCE_POLICY=migrated-veud-v1
cd "$release_root"
exec "$NODE_BIN" scripts/backup-database.mjs
