#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
guard_live_storage
load_application_environment
verify_node_22
[[ -L "$STAGING_ROOT/app/current" ]] || die 'No staged application release is active'
"$PG_BIN/pg_isready" --host=127.0.0.1 --port=5433 --dbname=veud_staging >/dev/null || die 'PostgreSQL is unavailable'
cd "$STAGING_ROOT/app/current"
exec "$NODE_BIN" .
