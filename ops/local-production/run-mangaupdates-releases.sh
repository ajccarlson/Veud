#!/usr/bin/env bash
# Record released manga chapters from MangaUpdates for tracked series.
#
# Invoked through node, never `npm run`: npm replaces inherited file descriptors
# with pipes and the catalog-writer lifetime-lock proof cannot pass through it.
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
acquire_provider_lock mangaupdates

run_guarded_worker scripts/import-mangaupdates-releases.ts \
	--commit \
	--limit "${VEUD_PRODUCTION_MANGAUPDATES_LIMIT:-200}" \
	--delay-ms "${VEUD_PRODUCTION_MANGAUPDATES_DELAY_MS:-1000}"
