#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
load_application_environment
load_staging_environment
verify_node_22
assert_staging_application_operations_database_identities
require_command flock

[[ -n "${MAL_CATALOG_POLICY_APPROVAL_REF:-}" ]] ||
	die 'MAL_CATALOG_POLICY_APPROVAL_REF is not configured'
acquire_staging_writer_lifetime_lock_shared
verify_active_staging_release
assert_staging_catalog_cutover_role writer

export DATABASE_URL="$STAGING_LOAD_DATABASE_URL"
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"

exec 9>"$STAGING_ROOT/run/jikan-provider.lock"
flock 9
cd "$STAGING_ROOT/app/current"
"$NODE_BIN" scripts/assert-catalog-writer-runtime.mjs
exec "$NODE_BIN" --import tsx scripts/hydrate-jikan-anime-cast.ts \
	--commit \
	--limit "${VEUD_STAGING_JIKAN_CAST_LIMIT:-100000}" \
	--delay-ms "${VEUD_STAGING_JIKAN_DELAY_MS:-1000}" \
	--lease-seconds "${VEUD_STAGING_CATALOG_LEASE_SECONDS:-30}" \
	--worker-id "staging-jikan:${HOSTNAME:-host}:$$"
