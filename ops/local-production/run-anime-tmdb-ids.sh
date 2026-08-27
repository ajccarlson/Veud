#!/usr/bin/env bash
# Map anime to the TMDB entry for the same work, so streaming availability can
# be looked up for them and so an anime can be recognised as the same work as a
# live-action row.
#
# Scope defaults to 'tracked'. Set VEUD_PRODUCTION_ANIME_TMDB_SCOPE=all to
# consider the whole anime catalog: that is roughly two orders of magnitude more
# candidates, so raise VEUD_PRODUCTION_ANIME_TMDB_LIMIT with it or a full pass
# takes months. Tracked anime are searched first either way.
#
# Invoked through node, never `npm run`: npm replaces inherited file descriptors
# with pipes and the catalog-writer lifetime-lock proof cannot pass through it.
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
acquire_provider_lock tmdb

run_guarded_worker scripts/resolve-anime-tmdb-ids.ts \
	--commit \
	--scope "${VEUD_PRODUCTION_ANIME_TMDB_SCOPE:-tracked}" \
	--limit "${VEUD_PRODUCTION_ANIME_TMDB_LIMIT:-300}" \
	--delay-ms "${VEUD_PRODUCTION_TMDB_DELAY_MS:-300}"
