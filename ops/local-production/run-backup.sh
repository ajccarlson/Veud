#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
guard_backup_storage
load_production_worker_environment
verify_node_22
assert_production_backup_database_identities
acquire_production_writer_lifetime_lock_shared
verify_active_release
assert_production_catalog_cutover_role backup

release_root="$APP_ROOT"
[[ -f "$release_root/scripts/backup-postgres.mjs" ]] ||
	die 'The selected production release cannot run PostgreSQL backups'
export BACKUP_SOURCE_POLICY=migrated-veud-v1
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
cd "$release_root"
exec "$NODE_BIN" scripts/backup-postgres.mjs
