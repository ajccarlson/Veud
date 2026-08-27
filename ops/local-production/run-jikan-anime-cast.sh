#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
[[ -n "${MAL_CATALOG_POLICY_APPROVAL_REF:-}" ]] ||
	die 'MAL_CATALOG_POLICY_APPROVAL_REF is not configured'
acquire_provider_lock jikan

run_guarded_worker scripts/hydrate-jikan-anime-cast.ts \
	--commit \
	--limit "${VEUD_PRODUCTION_JIKAN_CAST_LIMIT:-100000}" \
	--delay-ms "${VEUD_PRODUCTION_JIKAN_DELAY_MS:-1000}" \
	--lease-seconds "${VEUD_PRODUCTION_CATALOG_LEASE_SECONDS:-30}" \
	--worker-id "production-jikan:${HOSTNAME:-host}:$$"
