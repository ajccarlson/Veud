#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
exec "$NPM_BIN" run notifications:digests
