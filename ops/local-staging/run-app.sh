#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
guard_live_storage
load_application_environment
verify_node_22
assert_staging_application_database_identity
acquire_staging_writer_lifetime_lock_shared
active_release="$(
	cutover_active_release_id \
		"$STAGING_ROOT/app/current" \
		"$STAGING_ROOT/app/releases"
)" ||
	die 'The active staging release identity is invalid'
assert_staging_catalog_cutover_role app
"$PG_BIN/pg_isready" --host=127.0.0.1 --port=5433 --dbname=veud_staging >/dev/null || die 'PostgreSQL is unavailable'
cd "$STAGING_ROOT/app/current"
export VEUD_RELEASE="$active_release"
export VEUD_ENVIRONMENT=staging
exec "$NODE_BIN" .
