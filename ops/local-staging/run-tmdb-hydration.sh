#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
load_application_environment
load_staging_environment
verify_node_22
assert_staging_application_operations_database_identities
require_command flock

[[ -n "${TMDB_API_KEY:-}" ]] || die 'TMDB_API_KEY is not configured'
acquire_staging_writer_lifetime_lock_shared
verify_active_staging_release
assert_staging_catalog_cutover_role writer

export DATABASE_URL="$STAGING_LOAD_DATABASE_URL"
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"

exec 9>"$STAGING_ROOT/run/tmdb-provider.lock"
flock 9
cd "$STAGING_ROOT/app/current"
exec "$NPM_BIN" run catalog:tmdb-hydrate -- \
	--kind all \
	--seed-priorities \
	--commit \
	--limit "${VEUD_STAGING_TMDB_HYDRATION_LIMIT:-100000}" \
	--concurrency "${VEUD_STAGING_TMDB_CONCURRENCY:-4}" \
	--delay-ms "${VEUD_STAGING_TMDB_DELAY_MS:-100}"
