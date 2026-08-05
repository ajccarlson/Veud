#!/usr/bin/env bash
# Map tracked anime to the TMDB entry for the same work, so streaming
# availability can be looked up for them.
#
# Invoked through node, never `npm run`: npm replaces inherited file descriptors
# with pipes and the catalog-writer lifetime-lock proof cannot pass through it.
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
acquire_provider_lock tmdb

run_guarded_worker scripts/resolve-anime-tmdb-ids.ts \
	--commit \
	--limit "${VEUD_PRODUCTION_ANIME_TMDB_LIMIT:-300}" \
	--delay-ms "${VEUD_PRODUCTION_TMDB_DELAY_MS:-300}"
