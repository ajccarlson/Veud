#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../local-staging/common.sh"

PRODUCTION_ROOT="${VEUD_PRODUCTION_ROOT:-$LIVE_MOUNT/veud-production}"
PRODUCTION_CONFIG_FILE="$PRODUCTION_ROOT/config/postgres.env"
PRODUCTION_BACKUP_DIR="$PRODUCTION_ROOT/backups"
PRODUCTION_OFFSITE_DIR="${VEUD_PRODUCTION_OFFSITE_DIR:-$BACKUP_MOUNT/veud-production-backups}"
APPLICATION_CONFIG_FILE="$PRODUCTION_ROOT/config/application.env"
APP_ROOT="$PRODUCTION_ROOT/app/current"
PRODUCTION_CUTOVER_REQUESTED_RELEASE=''
PRODUCTION_CUTOVER_PHASE=''
PRODUCTION_APPLICATION_DATABASE_URL=''

load_production_environment() {
	[[ -f "$PRODUCTION_CONFIG_FILE" && ! -L "$PRODUCTION_CONFIG_FILE" ]] ||
		die "Production PostgreSQL configuration does not exist: $PRODUCTION_CONFIG_FILE"
	unset DATABASE_URL POSTGRES_BACKUP_VERIFY_URL
	set -a
	# shellcheck disable=SC1090
	source "$PRODUCTION_CONFIG_FILE"
	set +a
	[[ "${DATABASE_URL:-}" == postgresql://* || "${DATABASE_URL:-}" == postgres://* ]] ||
		die 'Production catalog workers require a PostgreSQL DATABASE_URL'
}

load_production_worker_environment() {
	[[ -f "$APPLICATION_CONFIG_FILE" && ! -L "$APPLICATION_CONFIG_FILE" ]] ||
		die "Production application configuration does not exist: $APPLICATION_CONFIG_FILE"
	unset DATABASE_URL
	set -a
	# Load provider/application credentials first, then deliberately override any
	# copied datasource with the qualified production PostgreSQL configuration.
	# shellcheck disable=SC1090
	source "$APPLICATION_CONFIG_FILE"
	set +a
	PRODUCTION_APPLICATION_DATABASE_URL="${DATABASE_URL:-}"
	load_production_environment
}

assert_production_application_database_identity() {
	verify_node_22
	assert_runtime_postgresql_datasource \
		'Production application datasource' \
		"$PRODUCTION_APPLICATION_DATABASE_URL" \
		veud_production_app \
		veud_production
	assert_runtime_postgresql_datasource \
		'Production operations datasource' \
		"${DATABASE_URL:-}" \
		veud_production_app \
		veud_production
	assert_runtime_datasource_parity \
		'Production' \
		"$PRODUCTION_APPLICATION_DATABASE_URL" \
		"${DATABASE_URL:-}"
	export_catalog_writer_lifetime_lock_proof \
		production \
		"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"
}

assert_production_backup_database_identities() {
	assert_production_application_database_identity
	assert_production_operations_database_identities
}

assert_production_operations_database_identities() {
	verify_node_22
	assert_runtime_postgresql_datasource \
		'Production operations datasource' \
		"${DATABASE_URL:-}" \
		veud_production_app \
		veud_production
	assert_runtime_postgresql_datasource \
		'Production restore datasource' \
		"${POSTGRES_BACKUP_VERIFY_URL:-}" \
		veud_production_restore \
		veud_production_restore
	export_catalog_writer_lifetime_lock_proof \
		production \
		"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"
}

production_database_identity() {
	verify_node_22
	(
		cd "$REPO_ROOT"
		DATABASE_URL="$DATABASE_URL" "$NODE_BIN" --input-type=module -e '
			import { assertProductionDatabaseUrl } from "./scripts/production-environment-utils.mjs"
			try {
				process.stdout.write(assertProductionDatabaseUrl(process.env.DATABASE_URL))
			} catch {
				console.error("Production DATABASE_URL is invalid")
				process.exit(1)
			}
		'
	)
}

verify_active_release() {
	[[ -f "$APP_ROOT/package.json" ]] ||
		die 'No immutable production application release is active'
	cutover_active_release_id "$APP_ROOT" "$PRODUCTION_ROOT/app/releases" \
		>/dev/null ||
		die 'The active production release target is invalid'
	[[ -x "$APP_ROOT/node_modules/.bin/tsx" ]] ||
		die 'The active production release does not contain validated dependencies'
}

assert_production_catalog_cutover_role() {
	local role="$1"
	local marker="$PRODUCTION_ROOT/run/catalog-release-maintenance.state"
	local emergency_marker="$PRODUCTION_ROOT/run/catalog-release-emergency-block.state"
	local format environment mutation_started release_activated original_release state_dir
	local active_release
	local active_release_target

	if [[ -e "$emergency_marker" || -L "$emergency_marker" ]]; then
		die "Production $role launch is blocked by emergency catalog maintenance state"
	fi
	if [[ ! -e "$marker" && ! -L "$marker" ]]; then
		return 0
	fi
	[[ -f "$marker" && ! -L "$marker" ]] ||
		die 'Production catalog maintenance authority is not a regular non-symlink file'
	case "$role" in
	app | backup | writer) ;;
	*) die "Unknown production catalog cutover role: $role" ;;
	esac

	format="$(read_catalog_cutover_marker_value "$marker" format)"
	environment="$(read_catalog_cutover_marker_value "$marker" environment)"
	PRODUCTION_CUTOVER_PHASE="$(
		read_catalog_cutover_marker_value "$marker" phase
	)"
	mutation_started="$(
		read_catalog_cutover_marker_value "$marker" database_mutation_started
	)"
	release_activated="$(
		read_catalog_cutover_marker_value "$marker" release_activated
	)"
	PRODUCTION_CUTOVER_REQUESTED_RELEASE="$(
		read_catalog_cutover_marker_value "$marker" requested_release
	)"
	original_release="$(
		read_catalog_cutover_marker_value "$marker" original_active_release
	)"
	state_dir="$(read_catalog_cutover_marker_value "$marker" state_dir)"
	[[ "$format" == 2 && "$environment" == production ]] ||
		die 'Production catalog maintenance marker has an unsupported format or environment'
	[[ "$mutation_started" == true || "$mutation_started" == false ]] ||
		die 'Production catalog maintenance marker has an invalid mutation boundary'
	[[ "$release_activated" == true || "$release_activated" == false ]] ||
		die 'Production catalog maintenance marker has an invalid activation boundary'
	[[ "$PRODUCTION_CUTOVER_REQUESTED_RELEASE" =~ ^[0-9a-f]{40}$ ]] ||
		die 'Production catalog maintenance marker has an invalid requested release'
	[[ "$original_release" =~ ^[0-9a-f]{40}$ ]] ||
		die 'Production catalog maintenance marker has an invalid original release'
	[[ "$state_dir" == "$PRODUCTION_ROOT/run/catalog-release-state-$PRODUCTION_CUTOVER_REQUESTED_RELEASE" &&
		-d "$state_dir" ]] ||
		die 'Production catalog maintenance marker has an invalid durable state directory'
	active_release="$(cat "$APP_ROOT/RELEASE" 2>/dev/null || true)"
	active_release_target="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"

	case "$role:$PRODUCTION_CUTOVER_PHASE:$mutation_started:$release_activated" in
	app:healthcheck-compatible-release:true:false)
		[[ "$active_release" == "$PRODUCTION_CUTOVER_REQUESTED_RELEASE" &&
			"$active_release_target" == "$PRODUCTION_ROOT/app/releases/$PRODUCTION_CUTOVER_REQUESTED_RELEASE" ]] &&
			return 0
		;;
	app:restore-before-mutation:false:false | \
	backup:restore-before-mutation:false:false | \
	writer:restore-before-mutation:false:false)
		[[ "$active_release" == "$original_release" &&
			"$active_release_target" == "$PRODUCTION_ROOT/app/releases/$original_release" ]] &&
			return 0
		;;
	app:release-healthy:true:true | app:resume-writers:true:true | \
	app:resume-backup:true:true | \
	writer:resume-writers:true:true | writer:resume-backup:true:true | \
	backup:resume-backup:true:true)
		[[ "$active_release" == "$PRODUCTION_CUTOVER_REQUESTED_RELEASE" &&
			"$active_release_target" == "$PRODUCTION_ROOT/app/releases/$PRODUCTION_CUTOVER_REQUESTED_RELEASE" ]] &&
			return 0
		;;
	esac

	die "Production $role launch is blocked during catalog cutover phase $PRODUCTION_CUTOVER_PHASE"
}

acquire_production_writer_lifetime_lock_shared() {
	require_command flock
	mkdir -p "$PRODUCTION_ROOT/run"
	if [[ -e "/proc/$$/fd/8" &&
		"$(readlink -f "/proc/$$/fd/8")" == "$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock" ]]; then
		flock --shared 8
		export_catalog_writer_lifetime_lock_proof \
			production \
			"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"
		return
	fi
	exec 8>"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"
	flock --shared 8
	export_catalog_writer_lifetime_lock_proof \
		production \
		"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"
}

prepare_worker() {
	guard_live_storage
	load_production_worker_environment
	verify_node_22
	assert_production_application_database_identity
	require_command flock
	mkdir -p "$PRODUCTION_ROOT/run"
	acquire_production_writer_lifetime_lock_shared
	verify_active_release
	assert_production_catalog_cutover_role writer
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
