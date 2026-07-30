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
assert_staging_catalog_cutover_role load-backup
release_root="$STAGING_ROOT/app/current"
[[ -f "$release_root/scripts/backup-postgres.mjs" ]] ||
	die 'The selected staging release cannot run catalog backups'
mkdir -p "$STAGING_ROOT/backups/catalog" "$OFFSITE_DIR/catalog"
chmod 700 "$STAGING_ROOT/backups/catalog" "$OFFSITE_DIR/catalog"

export DATABASE_URL="$STAGING_LOAD_DATABASE_URL"
export BACKUP_SOURCE_POLICY=migrated-veud-v1
export BACKUP_DIR="$STAGING_ROOT/backups/catalog"
export BACKUP_OFFSITE_DIR="$OFFSITE_DIR/catalog"
export BACKUP_KEEP="${VEUD_STAGING_CATALOG_BACKUP_KEEP:-14}"
export BACKUP_OFFSITE_KEEP="${VEUD_STAGING_CATALOG_OFFSITE_KEEP:-30}"

cd "$release_root"
exec "$NODE_BIN" scripts/backup-postgres.mjs
