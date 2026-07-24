#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
[[ -n "${TMDB_API_KEY:-}" ]] || die 'TMDB_API_KEY is not configured'
acquire_provider_lock tmdb

exec "$NPM_BIN" run catalog:tmdb-hydrate -- \
	--kind all \
	--seed-priorities \
	--commit \
	--limit "${VEUD_PRODUCTION_TMDB_HYDRATION_LIMIT:-100000}" \
	--concurrency "${VEUD_PRODUCTION_TMDB_CONCURRENCY:-4}" \
	--delay-ms "${VEUD_PRODUCTION_TMDB_DELAY_MS:-100}" \
	--worker-id "production-tmdb:${HOSTNAME:-host}:$$"
