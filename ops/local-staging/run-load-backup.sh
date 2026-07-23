#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
guard_backup_storage
load_staging_environment
verify_node_22

[[ -L "$STAGING_ROOT/app/current" ]] || die 'No staged application release is active'
mkdir -p "$STAGING_ROOT/backups/catalog" "$OFFSITE_DIR/catalog"
chmod 700 "$STAGING_ROOT/backups/catalog" "$OFFSITE_DIR/catalog"

export DATABASE_URL="$STAGING_LOAD_DATABASE_URL"
export BACKUP_DIR="$STAGING_ROOT/backups/catalog"
export BACKUP_OFFSITE_DIR="$OFFSITE_DIR/catalog"
export BACKUP_KEEP="${VEUD_STAGING_CATALOG_BACKUP_KEEP:-14}"
export BACKUP_OFFSITE_KEEP="${VEUD_STAGING_CATALOG_OFFSITE_KEEP:-30}"

cd "$STAGING_ROOT/app/current"
exec "$NODE_BIN" scripts/backup-postgres.mjs
