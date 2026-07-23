#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
guard_live_storage
exec "$PG_BIN/postgres" -D "$PGDATA" --config-file="$PGDATA/postgresql.conf"
