#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
[[ -n "${MAL_CLIENT_ID:-}" ]] || die 'MAL_CLIENT_ID is not configured'
[[ -n "${MAL_CATALOG_POLICY_APPROVAL_REF:-}" ]] ||
	die 'MAL_CATALOG_POLICY_APPROVAL_REF is not configured'
acquire_provider_lock mal

exec "$NPM_BIN" run catalog:mal-hydrate -- \
	--kind all \
	--commit \
	--limit "${VEUD_PRODUCTION_MAL_HYDRATION_LIMIT:-100000}" \
	--delay-ms "${VEUD_PRODUCTION_MAL_DELAY_MS:-1000}" \
	--lease-seconds "${VEUD_PRODUCTION_CATALOG_LEASE_SECONDS:-30}" \
	--worker-id "production-mal:${HOSTNAME:-host}:$$"
