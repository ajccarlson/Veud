#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO_ROOT/ops/catalog-cutover-common.sh"
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
STAGING_CUTOVER_REQUESTED_RELEASE=''
STAGING_CUTOVER_ORIGINAL_RELEASE=''
STAGING_CUTOVER_PHASE=''
STAGING_APPLICATION_DATABASE_URL=''

die() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null || die "Required command not found: $1"
}

assert_runtime_postgresql_datasource() {
	local label="$1"
	local database_url="${2:-}"
	local expected_user="$3"
	local expected_database="$4"

	if ! CATALOG_RUNTIME_DATABASE_URL="$database_url" \
		CATALOG_RUNTIME_EXPECTED_USER="$expected_user" \
		CATALOG_RUNTIME_EXPECTED_DATABASE="$expected_database" \
		"$NODE_BIN" --input-type=module -e '
			const raw = process.env.CATALOG_RUNTIME_DATABASE_URL ?? ""
			let url
			try {
				url = new URL(raw)
			} catch {
				process.exit(1)
			}
			const expectedPrefix =
				`postgresql://${process.env.CATALOG_RUNTIME_EXPECTED_USER}:`
			const expectedSuffix =
				`@127.0.0.1:5433/${process.env.CATALOG_RUNTIME_EXPECTED_DATABASE}` +
				"?schema=public"
			const valid =
				raw.startsWith(expectedPrefix) &&
				raw.endsWith(expectedSuffix) &&
				url.protocol === "postgresql:" &&
				url.username === process.env.CATALOG_RUNTIME_EXPECTED_USER &&
				url.password.length > 0 &&
				url.hostname === "127.0.0.1" &&
				url.port === "5433" &&
				url.pathname ===
					`/${process.env.CATALOG_RUNTIME_EXPECTED_DATABASE}` &&
				url.search === "?schema=public" &&
				url.searchParams.size === 1 &&
				url.searchParams.getAll("schema").length === 1 &&
				url.searchParams.get("schema") === "public" &&
				url.hash === ""
			process.exit(valid ? 0 : 1)
		'; then
		die "$label does not match the required local PostgreSQL identity"
	fi
}

assert_runtime_datasource_parity() {
	local label="$1"
	local application_url="${2:-}"
	local operations_url="${3:-}"

	[[ -n "$application_url" && "$application_url" == "$operations_url" ]] ||
		die "$label application and operations datasource configurations differ"
}

export_catalog_writer_lifetime_lock_proof() {
	local environment="$1"
	local lock_path="$2"

	export VEUD_CATALOG_WRITER_LOCK_ENVIRONMENT="$environment"
	export VEUD_CATALOG_WRITER_LOCK_PATH="$lock_path"
	export VEUD_CATALOG_WRITER_LOCK_HOLDER_PID="$$"
	# Deployment state machines hold descriptor 6 exclusively; ordinary
	# application and worker launchers hold descriptor 8 shared.
	export VEUD_CATALOG_WRITER_LOCK_FDS='6,8'
}

assert_staging_catalog_cutover_role() {
	local role="$1"
	local marker="$STAGING_ROOT/run/provenance-cutover-incomplete"
	local emergency_marker="$STAGING_ROOT/run/provenance-cutover-emergency-block"
	local format environment bootstrap backup_source_policy
	local mutation_started release_activated unit_state state_dir
	local active_release=''
	local active_release_id=''

	if [[ -e "$emergency_marker" || -L "$emergency_marker" ]]; then
		die "Staging $role launch is blocked by emergency catalog maintenance state"
	fi
	if [[ ! -e "$marker" && ! -L "$marker" ]]; then
		return 0
	fi
	[[ -f "$marker" && ! -L "$marker" ]] ||
		die 'Staging catalog cutover authority is not a regular non-symlink file'
	case "$role" in
	app | backup | load-backup | writer) ;;
	*) die "Unknown staging catalog cutover role: $role" ;;
	esac

	format="$(read_catalog_cutover_marker_value "$marker" format)"
	environment="$(read_catalog_cutover_marker_value "$marker" environment)"
	bootstrap="$(read_catalog_cutover_marker_value "$marker" bootstrap)"
	backup_source_policy="$(
		read_catalog_cutover_marker_value "$marker" backup_source_policy
	)"
	STAGING_CUTOVER_PHASE="$(
		read_catalog_cutover_marker_value "$marker" phase
	)"
	mutation_started="$(
		read_catalog_cutover_marker_value "$marker" mutation_started
	)"
	release_activated="$(
		read_catalog_cutover_marker_value "$marker" release_activated
	)"
	STAGING_CUTOVER_REQUESTED_RELEASE="$(
		read_catalog_cutover_marker_value "$marker" release
	)"
	STAGING_CUTOVER_ORIGINAL_RELEASE="$(
		read_catalog_cutover_marker_value "$marker" original_release
	)"
	unit_state="$(read_catalog_cutover_marker_value "$marker" unit_state)"
	state_dir="$(read_catalog_cutover_marker_value "$marker" state_dir)"
	[[ "$mutation_started" == true || "$mutation_started" == false ]] ||
		die 'Staging catalog cutover marker has an invalid mutation boundary'
	[[ "$release_activated" == true || "$release_activated" == false ]] ||
		die 'Staging catalog cutover marker has an invalid activation boundary'
	[[ "$format" == 2 && "$environment" == staging ]] ||
		die 'Staging catalog cutover marker has an unsupported format or environment'
	[[ "$bootstrap" == true || "$bootstrap" == false ]] ||
		die 'Staging catalog cutover marker has an invalid bootstrap boundary'
	[[ "$STAGING_CUTOVER_REQUESTED_RELEASE" =~ ^[0-9a-f]{40}$ ]] ||
		die 'Staging catalog cutover marker has an invalid release'
	if [[ "$bootstrap" == true ]]; then
		[[ "$STAGING_CUTOVER_ORIGINAL_RELEASE" == none ]] ||
			die 'Staging bootstrap marker has an invalid original release'
		[[ "$backup_source_policy" == pristine-empty-v1 ]] ||
			die 'Staging bootstrap marker has an invalid backup source policy'
	else
		[[ "$STAGING_CUTOVER_ORIGINAL_RELEASE" =~ ^[0-9a-f]{40}$ ]] ||
			die 'Staging catalog cutover marker has an invalid original release'
		[[ "$backup_source_policy" == migrated-veud-v1 ]] ||
			die 'Staging catalog cutover marker has an invalid backup source policy'
	fi
	[[ "$unit_state" == "$STAGING_ROOT/run/provenance-cutover-unit-state" &&
		-f "$unit_state" ]] ||
		die 'Staging catalog cutover marker has an invalid unit-state record'
	[[ "$state_dir" == "$STAGING_ROOT/run/provenance-cutover-state-$STAGING_CUTOVER_REQUESTED_RELEASE" &&
		-d "$state_dir" ]] ||
		die 'Staging catalog cutover marker has an invalid durable state directory'
	if [[ -L "$STAGING_ROOT/app/current" ]]; then
		active_release="$(readlink -f "$STAGING_ROOT/app/current")"
		active_release_id="$(cat "$STAGING_ROOT/app/current/RELEASE" 2>/dev/null || true)"
	fi

	case "$role:$STAGING_CUTOVER_PHASE:$mutation_started:$release_activated" in
	app:healthcheck-new-release:true:false)
		[[ "$active_release_id" == "$STAGING_CUTOVER_REQUESTED_RELEASE" &&
			"$active_release" == "$STAGING_ROOT/app/releases/$STAGING_CUTOVER_REQUESTED_RELEASE" ]] &&
			return 0
		;;
	app:restore-before-mutation:false:false | \
	backup:restore-before-mutation:false:false | \
	load-backup:restore-before-mutation:false:false | \
	writer:restore-before-mutation:false:false)
		[[ "$bootstrap" == false &&
			"$active_release_id" == "$STAGING_CUTOVER_ORIGINAL_RELEASE" &&
			"$active_release" == "$STAGING_ROOT/app/releases/$STAGING_CUTOVER_ORIGINAL_RELEASE" ]] &&
			return 0
		;;
	app:restore-prior-unit-states:true:true | \
	backup:restore-prior-unit-states:true:true | \
	load-backup:restore-prior-unit-states:true:true | \
	backup:post-bootstrap-application-backup:true:true | \
	load-backup:post-bootstrap-load-backup:true:true | \
	writer:restore-prior-unit-states:true:true)
		[[ "$active_release_id" == "$STAGING_CUTOVER_REQUESTED_RELEASE" &&
			"$active_release" == "$STAGING_ROOT/app/releases/$STAGING_CUTOVER_REQUESTED_RELEASE" ]] &&
			return 0
		;;
	esac

	die "Staging $role launch is blocked during catalog cutover phase $STAGING_CUTOVER_PHASE"
}

acquire_staging_writer_lifetime_lock_shared() {
	require_command flock
	mkdir -p "$STAGING_ROOT/run"
	if [[ -e "/proc/$$/fd/8" &&
		"$(readlink -f "/proc/$$/fd/8")" == "$STAGING_ROOT/run/catalog-writer-lifetime.lock" ]]; then
		flock --shared 8
		export_catalog_writer_lifetime_lock_proof \
			staging \
			"$STAGING_ROOT/run/catalog-writer-lifetime.lock"
		return
	fi
	exec 8>"$STAGING_ROOT/run/catalog-writer-lifetime.lock"
	flock --shared 8
	export_catalog_writer_lifetime_lock_proof \
		staging \
		"$STAGING_ROOT/run/catalog-writer-lifetime.lock"
}

verify_active_staging_release() {
	cutover_active_release_id \
		"$STAGING_ROOT/app/current" \
		"$STAGING_ROOT/app/releases" \
		>/dev/null ||
		die 'The active staging release identity is invalid'
}

assert_staging_database_identities() {
	local application_url="$1" operations_url="$2" load_url="$3" restore_url="$4"
	verify_node_22
	assert_runtime_postgresql_datasource \
		'Staging application datasource' \
		"$application_url" \
		veud_staging_app \
		veud_staging
	assert_runtime_postgresql_datasource \
		'Staging operations datasource' \
		"$operations_url" \
		veud_staging_app \
		veud_staging
	assert_runtime_datasource_parity \
		'Staging' \
		"$application_url" \
		"$operations_url"
	assert_runtime_postgresql_datasource \
		'Staging load datasource' \
		"$load_url" \
		veud_staging_load \
		veud_staging_load
	assert_runtime_postgresql_datasource \
		'Staging restore datasource' \
		"$restore_url" \
		veud_staging_restore \
		veud_staging_restore
	export_catalog_writer_lifetime_lock_proof \
		staging \
		"$STAGING_ROOT/run/catalog-writer-lifetime.lock"
}

assert_staging_application_database_identity() {
	verify_node_22
	assert_runtime_postgresql_datasource \
		'Staging application datasource' \
		"${DATABASE_URL:-}" \
		veud_staging_app \
		veud_staging
	export_catalog_writer_lifetime_lock_proof \
		staging \
		"$STAGING_ROOT/run/catalog-writer-lifetime.lock"
}

assert_staging_operations_database_identities() {
	assert_staging_database_identities \
		"${DATABASE_URL:-}" \
		"${DATABASE_URL:-}" \
		"${STAGING_LOAD_DATABASE_URL:-}" \
		"${POSTGRES_BACKUP_VERIFY_URL:-}"
}

assert_staging_application_operations_database_identities() {
	assert_staging_database_identities \
		"$STAGING_APPLICATION_DATABASE_URL" \
		"${DATABASE_URL:-}" \
		"${STAGING_LOAD_DATABASE_URL:-}" \
		"${POSTGRES_BACKUP_VERIFY_URL:-}"
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
	[[ -f "$CONFIG_FILE" && ! -L "$CONFIG_FILE" ]] ||
		die "Staging configuration does not exist: $CONFIG_FILE"
	unset DATABASE_URL STAGING_LOAD_DATABASE_URL POSTGRES_BACKUP_VERIFY_URL
	set -a
	# shellcheck disable=SC1090
	source "$CONFIG_FILE"
	set +a
}

load_application_environment() {
	[[ -f "$APPLICATION_CONFIG_FILE" && ! -L "$APPLICATION_CONFIG_FILE" ]] ||
		die "Application configuration does not exist: $APPLICATION_CONFIG_FILE"
	unset DATABASE_URL
	set -a
	# shellcheck disable=SC1090
	source "$APPLICATION_CONFIG_FILE"
	set +a
	STAGING_APPLICATION_DATABASE_URL="${DATABASE_URL:-}"
}

load_admin_environment() {
	[[ -f "$ADMIN_CONFIG_FILE" && ! -L "$ADMIN_CONFIG_FILE" ]] ||
		die "PostgreSQL admin configuration does not exist: $ADMIN_CONFIG_FILE"
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
		let url
		try {
			url = new URL(process.env.DATABASE_URL)
		} catch {
			console.error("DATABASE_URL must be a valid PostgreSQL URL")
			process.exit(1)
		}
		url.searchParams.delete("schema")
		process.stdout.write(url.toString())
	'
}
