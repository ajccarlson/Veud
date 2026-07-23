#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
load_staging_environment
verify_node_22
require_command flock

[[ -L "$STAGING_ROOT/app/current" ]] || die 'No staged application release is active'

export DATABASE_URL="$STAGING_LOAD_DATABASE_URL"
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"

exec 9>"$STAGING_ROOT/run/tmdb-provider.lock"
flock 9
cd "$STAGING_ROOT/app/current"
exec "$NPM_BIN" run catalog:tmdb-inventory -- \
	--kind all \
	--commit
