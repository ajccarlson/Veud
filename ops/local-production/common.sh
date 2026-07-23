#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../local-staging/common.sh"

PRODUCTION_ROOT="${VEUD_PRODUCTION_ROOT:-$LIVE_MOUNT/veud-production}"
PRODUCTION_CONFIG_FILE="$PRODUCTION_ROOT/config/postgres.env"
PRODUCTION_BACKUP_DIR="$PRODUCTION_ROOT/backups"
PRODUCTION_OFFSITE_DIR="${VEUD_PRODUCTION_OFFSITE_DIR:-$BACKUP_MOUNT/veud-production-backups}"

load_production_environment() {
	[[ -f "$PRODUCTION_CONFIG_FILE" ]] ||
		die "Production PostgreSQL configuration does not exist: $PRODUCTION_CONFIG_FILE"
	set -a
	# shellcheck disable=SC1090
	source "$PRODUCTION_CONFIG_FILE"
	set +a
}

production_database_identity() {
	verify_node_22
	DATABASE_URL="$DATABASE_URL" "$NODE_BIN" -e '
		const url = new URL(process.env.DATABASE_URL)
		process.stdout.write(`${url.hostname}:${url.port || "5432"}${url.pathname}`)
	'
}
