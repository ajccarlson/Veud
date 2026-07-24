#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
acquire_provider_lock tmdb

exec "$NPM_BIN" run catalog:tmdb-inventory -- \
	--kind all \
	--commit \
	--worker-id "production-tmdb-inventory:${HOSTNAME:-host}:$$"
