#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
acquire_provider_lock tmdb

run_guarded_worker scripts/import-tmdb-inventory.ts \
	--kind all \
	--commit \
	--worker-id "production-tmdb-inventory:${HOSTNAME:-host}:$$"
