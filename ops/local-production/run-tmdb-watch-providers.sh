#!/usr/bin/env bash
# Record where tracked titles can be watched, from TMDB's watch-provider data.
#
# Invoked through node, never `npm run`: npm replaces inherited file descriptors
# with pipes and the catalog-writer lifetime-lock proof cannot pass through it.
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
acquire_provider_lock tmdb

run_guarded_worker scripts/import-tmdb-watch-providers.ts \
	--commit \
	--limit "${VEUD_PRODUCTION_WATCH_PROVIDER_LIMIT:-800}" \
	--delay-ms "${VEUD_PRODUCTION_TMDB_DELAY_MS:-300}"
