#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
load_production_worker_environment
verify_node_22
assert_production_application_database_identity
acquire_production_writer_lifetime_lock_shared
verify_active_release
assert_production_catalog_cutover_role app

export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
export NODE_ENV=production
export VEUD_ENVIRONMENT=production
export VEUD_RELEASE
VEUD_RELEASE="$(cat "$APP_ROOT/RELEASE")"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4021}"

cd "$APP_ROOT"
exec "$NODE_BIN" scripts/pm2-entry.mjs
