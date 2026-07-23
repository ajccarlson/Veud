#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
guard_live_storage
guard_backup_storage
load_staging_environment
verify_node_22
[[ -L "$STAGING_ROOT/app/current" ]] || die 'No staged application release is active'
cd "$STAGING_ROOT/app/current"
exec "$NODE_BIN" scripts/backup-database.mjs
