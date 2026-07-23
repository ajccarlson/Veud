#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIVE_MOUNT="${VEUD_STAGING_LIVE_MOUNT:-/media/sde}"
BACKUP_MOUNT="${VEUD_STAGING_BACKUP_MOUNT:-/media/sdd}"
STAGING_ROOT="${VEUD_STAGING_ROOT:-$LIVE_MOUNT/veud-staging-postgres}"
OFFSITE_DIR="${VEUD_STAGING_OFFSITE_DIR:-$BACKUP_MOUNT/veud-staging-backups}"
APPLICATION_CONFIG_FILE="$STAGING_ROOT/config/application.env"
CONFIG_FILE="$STAGING_ROOT/config/operations.env"
ADMIN_CONFIG_FILE="$STAGING_ROOT/config/postgres-admin.env"
PG_VERSION="16.14"
PG_PREFIX="$STAGING_ROOT/runtime/postgresql-$PG_VERSION"
PG_BIN="$PG_PREFIX/bin"
PGDATA="$STAGING_ROOT/data"
PGSOCKET="$STAGING_ROOT/run"
PGLOG="$STAGING_ROOT/log"
NODE_BIN="${VEUD_STAGING_NODE_BIN:-$HOME/.nvm/versions/node/v22.23.1/bin/node}"
NPM_BIN="${VEUD_STAGING_NPM_BIN:-$HOME/.nvm/versions/node/v22.23.1/bin/npm}"

die() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null || die "Required command not found: $1"
}

require_mount() {
	local mount_point="$1" minimum_gib="$2" label="$3" options available_kib required_kib
	[[ "$(findmnt -rn -M "$mount_point" -o TARGET 2>/dev/null)" == "$mount_point" ]] ||
		die "$label is not mounted at $mount_point"
	options="$(findmnt -rn -M "$mount_point" -o OPTIONS)"
	[[ ",$options," == *,rw,* ]] || die "$label at $mount_point is not writable"
	[[ -w "$mount_point" ]] || die "$label at $mount_point is not writable by $USER"
	available_kib="$(df -Pk "$mount_point" | awk 'NR == 2 { print $4 }')"
	required_kib=$((minimum_gib * 1024 * 1024))
	((available_kib >= required_kib)) ||
		die "$label requires ${minimum_gib} GiB free; only $((available_kib / 1024 / 1024)) GiB available"
}

guard_live_storage() {
	require_mount "$LIVE_MOUNT" 100 'staging live drive'
}

guard_backup_storage() {
	require_mount "$BACKUP_MOUNT" 50 'staging backup drive'
	[[ "$(stat -c %d "$LIVE_MOUNT")" != "$(stat -c %d "$BACKUP_MOUNT")" ]] ||
		die 'live and backup paths must be on distinct filesystems'
}

load_staging_environment() {
	[[ -f "$CONFIG_FILE" ]] || die "Staging configuration does not exist: $CONFIG_FILE"
	set -a
	# shellcheck disable=SC1090
	source "$CONFIG_FILE"
	set +a
}

load_application_environment() {
	[[ -f "$APPLICATION_CONFIG_FILE" ]] || die "Application configuration does not exist: $APPLICATION_CONFIG_FILE"
	set -a
	# shellcheck disable=SC1090
	source "$APPLICATION_CONFIG_FILE"
	set +a
}

load_admin_environment() {
	[[ -f "$ADMIN_CONFIG_FILE" ]] || die "PostgreSQL admin configuration does not exist: $ADMIN_CONFIG_FILE"
	set -a
	# shellcheck disable=SC1090
	source "$ADMIN_CONFIG_FILE"
	set +a
}

verify_node_22() {
	[[ -x "$NODE_BIN" && -x "$NPM_BIN" ]] || die 'Pinned Node.js 22 runtime is unavailable'
	[[ "$($NODE_BIN --version)" == v22.* ]] || die 'Staging requires Node.js 22'
}

postgres_cli_url() {
	[[ -n "${DATABASE_URL:-}" ]] || die 'DATABASE_URL is not configured'
	verify_node_22
	DATABASE_URL="$DATABASE_URL" "$NODE_BIN" -e '
		const url = new URL(process.env.DATABASE_URL)
		url.searchParams.delete("schema")
		process.stdout.write(url.toString())
	'
}
