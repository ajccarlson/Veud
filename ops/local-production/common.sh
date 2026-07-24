#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../local-staging/common.sh"

PRODUCTION_ROOT="${VEUD_PRODUCTION_ROOT:-$LIVE_MOUNT/veud-production}"
PRODUCTION_CONFIG_FILE="$PRODUCTION_ROOT/config/postgres.env"
PRODUCTION_BACKUP_DIR="$PRODUCTION_ROOT/backups"
PRODUCTION_OFFSITE_DIR="${VEUD_PRODUCTION_OFFSITE_DIR:-$BACKUP_MOUNT/veud-production-backups}"
APPLICATION_CONFIG_FILE="$PRODUCTION_ROOT/config/application.env"
APP_ROOT="$PRODUCTION_ROOT/app/current"

load_production_environment() {
	[[ -f "$PRODUCTION_CONFIG_FILE" ]] ||
		die "Production PostgreSQL configuration does not exist: $PRODUCTION_CONFIG_FILE"
	set -a
	# shellcheck disable=SC1090
	source "$PRODUCTION_CONFIG_FILE"
	set +a
	[[ "${DATABASE_URL:-}" == postgresql://* || "${DATABASE_URL:-}" == postgres://* ]] ||
		die 'Production catalog workers require a PostgreSQL DATABASE_URL'
}

load_production_worker_environment() {
	[[ -f "$APPLICATION_CONFIG_FILE" ]] ||
		die "Production application configuration does not exist: $APPLICATION_CONFIG_FILE"
	set -a
	# Load provider/application credentials first, then deliberately override any
	# copied datasource with the qualified production PostgreSQL configuration.
	# shellcheck disable=SC1090
	source "$APPLICATION_CONFIG_FILE"
	set +a
	load_production_environment
}

production_database_identity() {
	verify_node_22
	DATABASE_URL="$DATABASE_URL" "$NODE_BIN" -e '
		const url = new URL(process.env.DATABASE_URL)
		process.stdout.write(`${url.hostname}:${url.port || "5432"}${url.pathname}`)
	'
}

verify_active_release() {
	[[ -L "$APP_ROOT" && -f "$APP_ROOT/package.json" ]] ||
		die 'No immutable production application release is active'
	[[ -x "$APP_ROOT/node_modules/.bin/tsx" ]] ||
		die 'The active production release does not contain validated dependencies'
}

prepare_worker() {
	guard_live_storage
	load_production_worker_environment
	verify_node_22
	verify_active_release
	require_command flock
	mkdir -p "$PRODUCTION_ROOT/run"
	export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
	cd "$APP_ROOT"
}

acquire_provider_lock() {
	local provider="$1"
	exec 9>"$PRODUCTION_ROOT/run/$provider-provider.lock"
	if ! flock -n 9; then
		printf '%s provider worker is already active; this scheduled run will retry later.\n' "$provider"
		exit 0
	fi
}
