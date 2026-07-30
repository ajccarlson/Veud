#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
guard_backup_storage
verify_node_22
require_command awk
require_command curl
[[ -x "${CUTOVER_CURL_BIN:-/usr/bin/curl}" ]] ||
	die 'Health checks require an executable ${CUTOVER_CURL_BIN:-/usr/bin/curl}'
require_command comm
require_command find
require_command git
require_command flock
require_command install
require_command sha256sum
require_command sync
require_command systemctl
require_command tar

umask 077

cd "$REPO_ROOT"
release="$(git rev-parse HEAD)"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] ||
	die 'Unable to resolve the full release revision'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
	die 'Refusing to package a release with tracked working-tree changes'

releases_root="$PRODUCTION_ROOT/app/releases"
destination="$releases_root/$release"
partial="$releases_root/.${release}.partial-$$"
current="$PRODUCTION_ROOT/app/current"
current_next="$PRODUCTION_ROOT/app/.current-${release}-$$"
maintenance_state="$PRODUCTION_ROOT/run/catalog-release-maintenance.state"
preparation_state="$PRODUCTION_ROOT/run/catalog-release-preparation.state"
emergency_block_state="$PRODUCTION_ROOT/run/catalog-release-emergency-block.state"
completion_cleanup_state="$PRODUCTION_ROOT/run/catalog-release-completion-cleanup.state"
state_dir="$PRODUCTION_ROOT/run/catalog-release-state-$release"
pm2_bin="$destination/node_modules/.bin/pm2"
pm2_dump_file="${PM2_HOME:-$HOME/.pm2}/dump.pm2"
pm2_restore_tmp="${pm2_dump_file}.cutover-restore-$$"
unit_dir="$HOME/.config/systemd/user"
writer_lifetime_lock="$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"

writer_services=(
	veud-production-mal-hydration.service
	veud-production-mal-inventory.service
	veud-production-mal-trending.service
	veud-production-tmdb-hydration.service
	veud-production-tmdb-inventory.service
	veud-production-retention-cleanup.service
	veud-production-notification-digests.service
)
writer_timers=(
	veud-production-mal-hydration.timer
	veud-production-mal-inventory.timer
	veud-production-mal-trending.timer
	veud-production-tmdb-hydration.timer
	veud-production-tmdb-inventory.timer
	veud-production-retention-cleanup.timer
	veud-production-notification-digests.timer
)
all_writer_units=("${writer_services[@]}" "${writer_timers[@]}")
declare -A original_unit_states=()
declare -A original_unit_enabled_states=()
original_active_release=''
original_pm2_veud_state=''
original_pm2_backup_state=''
maintenance_preexisting=false
maintenance_loaded=false
maintenance_started=false
locks_held=false
writer_lifetime_lock_held=false
database_mutation_started=false
release_activated=false
deployment_succeeded=false
transition_failure_handled=false
preparation_started=false
cutover_backup_archive=''
cutover_backup_receipt=''
cutover_backup_offsite_archive=''
cutover_backup_offsite_receipt=''
production_source_identity=''
production_restore_identity=''

write_production_emergency_block() {
	local temporary_state="${emergency_block_state}.tmp-$$"
	if [[ -e "$emergency_block_state" || -L "$emergency_block_state" ]]; then
		[[ -f "$emergency_block_state" && ! -L "$emergency_block_state" ]] ||
			die 'Production emergency block authority is not a regular non-symlink file'
		[[ "$(read_catalog_cutover_marker_value "$emergency_block_state" format)" == 1 &&
			"$(read_catalog_cutover_marker_value "$emergency_block_state" environment)" == production &&
			"$(read_catalog_cutover_marker_value "$emergency_block_state" requested_release)" == "$release" ]] ||
			die 'Production emergency block authority belongs to another release'
		return 0
	fi
	{
		printf 'format=1\n'
		printf 'environment=production\n'
		printf 'requested_release=%s\n' "$release"
		printf 'recorded_at=%s\n' "$(date --iso-8601=seconds)"
	} >"$temporary_state"
	chmod 600 "$temporary_state"
	cutover_publish_file_durable "$temporary_state" "$emergency_block_state"
}

write_production_completion_cleanup_state() {
	local temporary_state="${completion_cleanup_state}.tmp-$$"
	local active_release
	active_release="$(
		cutover_active_release_id "$APP_ROOT" "$PRODUCTION_ROOT/app/releases"
	)" || die 'Production completion cleanup cannot attest the active release'
	if [[ -e "$completion_cleanup_state" || -L "$completion_cleanup_state" ]]; then
		[[ -f "$completion_cleanup_state" && ! -L "$completion_cleanup_state" ]] ||
			die 'Production completion cleanup authority is not a regular non-symlink file'
		[[ "$(read_catalog_cutover_marker_value "$completion_cleanup_state" format)" == 2 &&
			"$(read_catalog_cutover_marker_value "$completion_cleanup_state" environment)" == production &&
			"$(read_catalog_cutover_marker_value "$completion_cleanup_state" release)" == "$release" &&
			"$(read_catalog_cutover_marker_value "$completion_cleanup_state" active_release)" == "$active_release" ]] ||
			die 'Production completion cleanup belongs to another release or format'
		return 0
	fi
	{
		printf 'format=2\n'
		printf 'environment=production\n'
		printf 'release=%s\n' "$release"
		printf 'active_release=%s\n' "$active_release"
		printf 'recorded_at=%s\n' "$(date --iso-8601=seconds)"
	} >"$temporary_state"
	chmod 600 "$temporary_state"
	cutover_publish_file_durable "$temporary_state" "$completion_cleanup_state"
}

cleanup_completed_production_release() {
	local authority completed_release='' expected_active_release=''
	local active_release='' active_target=''
	local failed=0
	if [[ ! -e "$completion_cleanup_state" && ! -L "$completion_cleanup_state" ]]; then
		return 0
	fi
	[[ -f "$completion_cleanup_state" && ! -L "$completion_cleanup_state" ]] ||
		die 'Production completion cleanup authority is not a regular non-symlink file'
	[[ "$(read_catalog_cutover_marker_value "$completion_cleanup_state" format)" == 2 &&
		"$(read_catalog_cutover_marker_value "$completion_cleanup_state" environment)" == production ]] ||
		die 'Production completion cleanup has an invalid format or environment'
	completed_release="$(
		read_catalog_cutover_marker_value "$completion_cleanup_state" release
	)"
	[[ "$completed_release" =~ ^[0-9a-f]{40}$ ]] ||
		die 'Production completion cleanup has an invalid release'
	expected_active_release="$(
		read_catalog_cutover_marker_value \
			"$completion_cleanup_state" \
			active_release
	)"
	[[ "$expected_active_release" =~ ^[0-9a-f]{40}$ ]] ||
		die 'Production completion cleanup has an invalid active release'
	active_release="$(cat "$APP_ROOT/RELEASE" 2>/dev/null || true)"
	active_target="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"
	[[ "$active_release" == "$expected_active_release" &&
		"$active_target" == "$PRODUCTION_ROOT/app/releases/$expected_active_release" ]] ||
		die 'Production completion cleanup does not match the active release'
	for authority in "$maintenance_state" "$preparation_state"; do
		if [[ -e "$authority" || -L "$authority" ]]; then
			[[ -f "$authority" && ! -L "$authority" ]] ||
				die "Production completion cleanup found malformed authority: $authority"
			[[ "$(read_catalog_cutover_marker_value "$authority" format)" == 2 &&
				"$(read_catalog_cutover_marker_value "$authority" environment)" == production &&
				"$(read_catalog_cutover_marker_value "$authority" requested_release)" == "$completed_release" ]] ||
				die 'Production completion cleanup found foreign cutover authority'
		fi
	done
	authority="$emergency_block_state"
	if [[ -e "$authority" || -L "$authority" ]]; then
		[[ -f "$authority" && ! -L "$authority" ]] ||
			die 'Production completion cleanup found malformed emergency authority'
		[[ "$(read_catalog_cutover_marker_value "$authority" format)" == 1 &&
			"$(read_catalog_cutover_marker_value "$authority" environment)" == production &&
			"$(read_catalog_cutover_marker_value "$authority" requested_release)" == "$completed_release" ]] ||
			die 'Production completion cleanup found foreign emergency authority'
	fi
	remove_production_cutover_authority
	cutover_remove_file_durable "$emergency_block_state"
	cutover_remove_tree_durable \
		"$PRODUCTION_ROOT/run/catalog-release-state-$completed_release" ||
		failed=1
	cutover_remove_tree_durable \
		"$PRODUCTION_BACKUP_DIR/.cutover-pins/$completed_release" ||
		failed=1
	cutover_remove_tree_durable \
		"$PRODUCTION_OFFSITE_DIR/.cutover-pins/$completed_release" ||
		failed=1
	if ((failed == 0)); then
		cutover_remove_file_durable "$completion_cleanup_state"
		return
	fi
	return 1
}

is_writer_unit() {
	local candidate="$1" unit
	for unit in "${all_writer_units[@]}"; do
		[[ "$candidate" == "$unit" ]] && return 0
	done
	return 1
}

is_writer_timer() {
	local candidate="$1" unit
	for unit in "${writer_timers[@]}"; do
		[[ "$candidate" == "$unit" ]] && return 0
	done
	return 1
}

acquire_writer_lifetime_lock_exclusive() {
	local wait_seconds="${VEUD_PRODUCTION_DEPLOY_LOCK_WAIT_SECONDS:-120}"
	if [[ ! "$wait_seconds" =~ ^[1-9][0-9]*$ ]]; then
		printf '%s\n' \
			'VEUD_PRODUCTION_DEPLOY_LOCK_WAIT_SECONDS must be a positive integer' >&2
		return 1
	fi
	if [[ "$writer_lifetime_lock_held" == true ]]; then
		return 0
	fi
	exec 6>"$writer_lifetime_lock"
	if ! flock --exclusive --wait "$wait_seconds" 6; then
		printf '%s\n' \
			'Timed out draining supported production database writers' >&2
		exec 6>&-
		return 1
	fi
	writer_lifetime_lock_held=true
}

release_writer_lifetime_lock() {
	if [[ "$writer_lifetime_lock_held" == true ]]; then
		exec 6>&-
		writer_lifetime_lock_held=false
	fi
}

capture_unit_definitions() {
	cutover_capture_unit_definitions \
		"$state_dir" \
		"$unit_dir" \
		"${all_writer_units[@]}"
}

verify_captured_unit_definitions() {
	cutover_verify_captured_unit_definitions \
		"$state_dir" \
		"${all_writer_units[@]}"
}

verify_captured_pm2_definitions() {
	local captured="$state_dir/original-pm2.dump"
	[[ -f "$captured" ]] || return 1
	PM2_DUMP_PATH="$captured" "$NODE_BIN" --input-type=module -e '
		import fs from "node:fs"
		const entries = JSON.parse(fs.readFileSync(process.env.PM2_DUMP_PATH, "utf8"))
		if (!Array.isArray(entries)) process.exit(1)
		for (const name of ["veud", "veud-backup"]) {
			if (entries.filter((entry) => entry?.name === name).length !== 1) {
				process.exit(1)
			}
		}
	'
}

capture_original_pm2_definitions() {
	save_pm2_state
	[[ -f "$pm2_dump_file" ]] ||
		die 'PM2 did not produce a durable process-definition dump'
	cp -a "$pm2_dump_file" "$state_dir/original-pm2.dump"
	chmod 600 "$state_dir/original-pm2.dump"
	verify_captured_pm2_definitions ||
		die 'PM2 dump does not contain one exact definition for each Veud process'
}

install_immutable_writer_unit_definitions() {
	cutover_install_immutable_units \
		"$state_dir" \
		"$unit_dir" \
		"$destination/ops/local-production/systemd" \
		'%h/Programs/Veud/ops/local-production' \
		"$destination/ops/local-production" \
		"${all_writer_units[@]}"
}

restore_original_unit_definitions() {
	cutover_restore_unit_definitions \
		"$state_dir" \
		"$unit_dir" \
		"${all_writer_units[@]}"
}

systemd_active_state() {
	local unit="$1" load_state active_state
	load_state="$(systemctl --user show --property=LoadState --value "$unit")"
	# A writer unit the release ships but this host has never installed is
	# reported as `not-found`. Refusing here made such a unit impossible to ever
	# install, because the only thing that installs writer units is this same
	# deployment, a few steps further on. A unit that does not exist is by
	# definition not running, so report it inactive and let the install proceed;
	# capture already records absent unit files separately. Any other non-loaded
	# state (a malformed or masked unit) is still a hard failure.
	if [[ "$load_state" == not-found ]]; then
		printf 'inactive'
		return 0
	fi
	[[ "$load_state" == loaded ]] || die "Required writer unit is not loaded: $unit"
	active_state="$(systemctl --user show --property=ActiveState --value "$unit")"
	case "$active_state" in
	active | inactive) ;;
	*)
		die "Writer unit $unit is $active_state; wait for a stable active/inactive state and retry"
		;;
	esac
	printf '%s' "$active_state"
}

pm2_process_state() {
	local name="$1" state
	state="$(
		"$pm2_bin" jlist --silent |
			"$NODE_BIN" -e '
				const target = process.argv[1]
				let input = ""
				process.stdin.setEncoding("utf8")
				process.stdin.on("data", (chunk) => {
					input += chunk
				})
				process.stdin.on("end", () => {
					const processes = JSON.parse(input)
					const matches = processes.filter((process) => process.name === target)
					if (matches.length > 1) {
						console.error(`Duplicate PM2 process name: ${target}`)
						process.exit(1)
					}
					process.stdout.write(matches[0]?.pm2_env?.status ?? "absent")
				})
			' "$name"
	)"
	case "$state" in
	absent | online | stopped | errored | launching | stopping | 'waiting restart' | one-launch-status) ;;
	*) die "Unsupported PM2 state for $name: $state" ;;
	esac
	printf '%s' "$state"
}

pm2_process_exit_code() {
	local name="$1"
	"$pm2_bin" jlist --silent |
		"$NODE_BIN" -e '
			const target = process.argv[1]
			let input = ""
			process.stdin.setEncoding("utf8")
			process.stdin.on("data", (chunk) => {
				input += chunk
			})
			process.stdin.on("end", () => {
				const processes = JSON.parse(input)
				const matches = processes.filter((process) => process.name === target)
				if (matches.length !== 1) process.exit(1)
				process.stdout.write(String(matches[0]?.pm2_env?.exit_code ?? "unknown"))
			})
		' "$name"
}

pm2_process_script_path() {
	local name="$1"
	"$pm2_bin" jlist --silent |
		"$NODE_BIN" -e '
			const target = process.argv[1]
			let input = ""
			process.stdin.setEncoding("utf8")
			process.stdin.on("data", (chunk) => {
				input += chunk
			})
			process.stdin.on("end", () => {
				const processes = JSON.parse(input)
				const matches = processes.filter((process) => process.name === target)
				if (matches.length !== 1) process.exit(1)
				process.stdout.write(String(matches[0]?.pm2_env?.pm_exec_path ?? ""))
			})
		' "$name"
}

install_guarded_pm2_definitions() {
	local name state app_script backup_script
	for name in veud veud-backup; do
		if [[ "$(pm2_process_state "$name")" != absent ]]; then
			"$pm2_bin" delete "$name"
		fi
	done
		(
			cd "$destination"
			NODE_ENV=production \
				"$pm2_bin" start ecosystem.config.cjs \
			--only veud \
			--env production \
			--update-env
		NODE_ENV=production "$pm2_bin" start ecosystem.config.cjs \
			--only veud-backup \
			--env production \
			--update-env
	)
	for name in veud veud-backup; do
		state="$(pm2_process_state "$name")"
		if [[ "$state" != stopped ]]; then
			"$pm2_bin" stop "$name"
		fi
	done
	app_script="$(pm2_process_script_path veud)"
	backup_script="$(pm2_process_script_path veud-backup)"
	[[ "$app_script" == "$destination/ops/local-production/run-app.sh" ]] ||
		die 'PM2 web process is not guarded by the candidate release'
	[[ "$backup_script" == "$destination/ops/local-production/run-backup.sh" ]] ||
		die 'PM2 backup process is not guarded by the candidate release'
	[[ "$(pm2_process_state veud)" == stopped &&
		"$(pm2_process_state veud-backup)" == stopped ]] ||
		die 'Guarded PM2 definitions were not saved in a stopped state'
	save_pm2_state
}

remove_pm2_boot_definitions() {
	local name
	for name in veud veud-backup; do
		if [[ "$(pm2_process_state "$name")" != absent ]]; then
			"$pm2_bin" delete "$name"
		fi
	done
	save_pm2_state
}

restore_original_pm2_definitions() {
	local name merged_dump="$pm2_restore_tmp"
	verify_captured_pm2_definitions || return 1
	rm -f "$merged_dump"
	for name in veud veud-backup; do
		if [[ "$(pm2_process_state "$name")" != absent ]]; then
			"$pm2_bin" delete "$name" || return 1
		fi
	done
	save_pm2_state || return 1
	PM2_CAPTURED_DUMP="$state_dir/original-pm2.dump" \
		PM2_CURRENT_DUMP="$pm2_dump_file" \
		PM2_MERGED_DUMP="$merged_dump" \
		"$NODE_BIN" --input-type=module -e '
			import fs from "node:fs"
			const captured = JSON.parse(
				fs.readFileSync(process.env.PM2_CAPTURED_DUMP, "utf8"),
			)
			const current = JSON.parse(
				fs.readFileSync(process.env.PM2_CURRENT_DUMP, "utf8"),
			)
			const names = new Set(["veud", "veud-backup"])
			const originals = captured.filter((entry) => names.has(entry?.name))
			if (originals.length !== names.size) process.exit(1)
			const merged = [
				...current.filter((entry) => !names.has(entry?.name)),
				...originals,
			]
			fs.writeFileSync(process.env.PM2_MERGED_DUMP, JSON.stringify(merged))
		' || return 1
	chmod 600 "$merged_dump" || return 1
	cutover_publish_file_durable "$merged_dump" "$pm2_dump_file" || return 1
	"$pm2_bin" resurrect >/dev/null || return 1
	for name in veud veud-backup; do
		[[ "$(pm2_process_state "$name")" != absent ]] || return 1
	done
	if [[ "$original_pm2_veud_state" == stopped ]]; then
		"$pm2_bin" stop veud || return 1
	fi
	if [[ "$original_pm2_backup_state" == stopped ]]; then
		"$pm2_bin" stop veud-backup || return 1
	fi
	save_pm2_state
}

write_maintenance_state() {
	local phase="$1" target="${2:-$maintenance_state}" unit
	local target_tmp="${target}.tmp-$$"
	umask 077
	{
		printf 'format=2\n'
		printf 'environment=production\n'
		printf 'original_active_release=%s\n' "$original_active_release"
		printf 'requested_release=%s\n' "$release"
		printf 'state_dir=%s\n' "$state_dir"
		printf 'phase=%s\n' "$phase"
		printf 'database_mutation_started=%s\n' "$database_mutation_started"
		printf 'release_activated=%s\n' "$release_activated"
		printf 'cutover_backup_archive=%s\n' "$cutover_backup_archive"
		printf 'cutover_backup_receipt=%s\n' "$cutover_backup_receipt"
		printf 'cutover_backup_offsite_archive=%s\n' \
			"$cutover_backup_offsite_archive"
		printf 'cutover_backup_offsite_receipt=%s\n' \
			"$cutover_backup_offsite_receipt"
		printf 'original_pm2_veud=%s\n' "$original_pm2_veud_state"
		printf 'original_pm2_veud_backup=%s\n' "$original_pm2_backup_state"
		for unit in "${all_writer_units[@]}"; do
			printf 'unit.%s=%s\n' "$unit" "${original_unit_states[$unit]}"
			printf 'enabled.%s=%s\n' \
				"$unit" "${original_unit_enabled_states[$unit]}"
		done
	} >"$target_tmp"
	cutover_sync_tree "$state_dir"
	cutover_publish_file_durable "$target_tmp" "$target"
}

load_maintenance_state() {
	local source_state="${1:-$maintenance_state}"
	local key value unit
	local loaded_format='' loaded_environment='' loaded_state_dir=''
	local loaded_original_release='' loaded_requested_release=''
	local loaded_phase='' loaded_mutation='' loaded_activation=''
	local loaded_backup_archive='' loaded_backup_receipt=''
	local loaded_offsite_archive='' loaded_offsite_receipt=''
	local loaded_pm2_veud='' loaded_pm2_backup=''
	local active_release active_target
	local -A seen=()
	local -A loaded_units=()
	local -A loaded_enabled_units=()

	while IFS='=' read -r key value; do
		[[ -n "$key" && -z "${seen[$key]+set}" ]] ||
			die 'Production maintenance state is malformed or contains duplicate keys'
		seen["$key"]=1
		case "$key" in
		format) loaded_format="$value" ;;
		environment) loaded_environment="$value" ;;
		original_active_release) loaded_original_release="$value" ;;
		requested_release) loaded_requested_release="$value" ;;
		state_dir) loaded_state_dir="$value" ;;
		phase) loaded_phase="$value" ;;
		database_mutation_started) loaded_mutation="$value" ;;
		release_activated) loaded_activation="$value" ;;
		cutover_backup_archive) loaded_backup_archive="$value" ;;
		cutover_backup_receipt) loaded_backup_receipt="$value" ;;
		cutover_backup_offsite_archive) loaded_offsite_archive="$value" ;;
		cutover_backup_offsite_receipt) loaded_offsite_receipt="$value" ;;
		original_pm2_veud) loaded_pm2_veud="$value" ;;
		original_pm2_veud_backup) loaded_pm2_backup="$value" ;;
		unit.*)
			unit="${key#unit.}"
			is_writer_unit "$unit" ||
				die "Production maintenance state names an unknown writer unit: $unit"
			loaded_units["$unit"]="$value"
			;;
		enabled.*)
			unit="${key#enabled.}"
			is_writer_unit "$unit" ||
				die "Production maintenance state names an unknown enabled unit: $unit"
			[[ "$value" =~ ^[a-z-]+$ ]] ||
				die "Production maintenance state has an invalid enabled state for $unit"
			loaded_enabled_units["$unit"]="$value"
			;;
		*) die "Production maintenance state contains an unknown key: $key" ;;
		esac
	done <"$source_state"

	[[ "$loaded_format" == 2 && "$loaded_environment" == production ]] ||
		die 'Unsupported production maintenance state format'
	[[ "$loaded_original_release" =~ ^[0-9a-f]{40}$ ]] ||
		die 'Production maintenance state has an invalid original release'
	[[ "$loaded_requested_release" =~ ^[0-9a-f]{40}$ ]] ||
		die 'Production maintenance state has an invalid requested release'
	[[ "$loaded_requested_release" == "$release" ]] ||
		die 'Production maintenance state belongs to a different requested release'
	[[ "$loaded_state_dir" == "$state_dir" && -d "$loaded_state_dir" ]] ||
		die 'Production maintenance state has an invalid durable state directory'
	verify_captured_unit_definitions ||
		die 'Production maintenance state has invalid captured unit definitions'
	verify_captured_pm2_definitions ||
		die 'Production maintenance state has invalid captured PM2 definitions'
	[[ "$loaded_phase" =~ ^[a-z0-9-]+$ ]] ||
		die 'Production maintenance state has an invalid phase'
	[[ "$loaded_mutation" == true || "$loaded_mutation" == false ]] ||
		die 'Production maintenance state has an invalid mutation boundary'
	[[ "$loaded_activation" == true || "$loaded_activation" == false ]] ||
		die 'Production maintenance state has an invalid activation boundary'
	[[ "$loaded_pm2_veud" == online ]] ||
		die 'Production maintenance state does not describe the expected online web process'
	[[ "$loaded_pm2_backup" == online || "$loaded_pm2_backup" == stopped ]] ||
		die 'Production maintenance state has an invalid backup-process state'
	active_release="$(cat "$APP_ROOT/RELEASE" 2>/dev/null || true)"
	active_target="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"
	[[ "$active_release" == "$loaded_original_release" ||
		"$active_release" == "$loaded_requested_release" ]] ||
		die 'Active production release is outside the recorded cutover boundary'
	[[ "$active_target" == "$PRODUCTION_ROOT/app/releases/$active_release" ]] ||
		die 'Active production symlink is outside the recorded cutover boundary'
	cutover_release_boundary_matches \
		"$loaded_mutation" \
		"$loaded_activation" \
		"$loaded_phase" \
		false \
		"$active_release" \
		"$loaded_original_release" \
		"$loaded_requested_release" \
		healthcheck-compatible-release ||
		die 'Production maintenance state crosses its recorded release boundary'
	for unit in "${all_writer_units[@]}"; do
		[[ "${loaded_units[$unit]:-}" == active ||
			"${loaded_units[$unit]:-}" == inactive ]] ||
			die "Production maintenance state is missing a stable state for $unit"
		[[ -n "${loaded_enabled_units[$unit]:-}" ]] ||
			die "Production maintenance state is missing the enabled state for $unit"
	done

	original_active_release="$loaded_original_release"
	original_pm2_veud_state="$loaded_pm2_veud"
	original_pm2_backup_state="$loaded_pm2_backup"
	database_mutation_started="$loaded_mutation"
	release_activated="$loaded_activation"
	cutover_backup_archive="$loaded_backup_archive"
	cutover_backup_receipt="$loaded_backup_receipt"
	cutover_backup_offsite_archive="$loaded_offsite_archive"
	cutover_backup_offsite_receipt="$loaded_offsite_receipt"
	original_unit_states=()
	original_unit_enabled_states=()
	for unit in "${all_writer_units[@]}"; do
		original_unit_states["$unit"]="${loaded_units[$unit]}"
		original_unit_enabled_states["$unit"]="${loaded_enabled_units[$unit]}"
	done
	maintenance_loaded=true
	maintenance_started=true
}

stop_writer_unit() {
	local unit="$1" state
	state="$(systemctl --user show --property=ActiveState --value "$unit")"
	case "$state" in
	active | activating | deactivating | reloading)
		systemctl --user stop "$unit"
		;;
	inactive | failed) ;;
	*) die "Unsupported current systemd state for $unit: $state" ;;
	esac
	state="$(systemctl --user show --property=ActiveState --value "$unit")"
	case "$state" in
	active | activating | deactivating | reloading)
		die "Writer unit did not stop: $unit"
		;;
	esac
}

stop_pm2_process() {
	local name="$1" state
	state="$(pm2_process_state "$name")"
	if [[ "$state" != absent && "$state" != stopped ]]; then
		"$pm2_bin" stop "$name"
	fi
	state="$(pm2_process_state "$name")"
	[[ "$state" == absent || "$state" == stopped ]] ||
		die "PM2 process did not stop: $name ($state)"
}

save_pm2_state() {
	"$pm2_bin" save --force >/dev/null
	[[ -f "$pm2_dump_file" ]] || return 1
	cutover_sync_path_and_parent "$pm2_dump_file"
}

release_provider_locks() {
	if [[ "$locks_held" == true ]]; then
		exec 8>&-
		exec 9>&-
		locks_held=false
	fi
}

verify_backup_pair() {
	cutover_verify_backup_pair "$NODE_BIN" "$@"
}

create_and_pin_cutover_backup() {
	local backup_dir="$1" offsite_dir="$2" label="$3"
	shift 3
	IFS=$'\t' read -r \
		cutover_backup_archive \
		cutover_backup_receipt \
		cutover_backup_offsite_archive \
		cutover_backup_offsite_receipt < <(
		cutover_create_and_pin_backup \
			"$NODE_BIN" \
			"$state_dir" \
			"$backup_dir" \
			"$offsite_dir" \
			"$backup_dir/.cutover-pins/$release" \
			"$offsite_dir/.cutover-pins/$release" \
			"$label" \
			"$production_source_identity" \
			"$production_restore_identity" \
			migrated-veud-v1 \
			"$@"
	)
	verify_cutover_backup_evidence
}

reconcile_cutover_backup_evidence() {
	local reconciled status
	if reconciled="$(
		cutover_reconcile_backup_pins \
			"$NODE_BIN" \
			"$PRODUCTION_BACKUP_DIR" \
			"$PRODUCTION_OFFSITE_DIR" \
			"$PRODUCTION_BACKUP_DIR/.cutover-pins/$release" \
			"$PRODUCTION_OFFSITE_DIR/.cutover-pins/$release" \
			application \
			"$production_source_identity" \
			"$production_restore_identity" \
			migrated-veud-v1
	)"; then
		IFS=$'\t' read -r \
			cutover_backup_archive \
			cutover_backup_receipt \
			cutover_backup_offsite_archive \
			cutover_backup_offsite_receipt <<<"$reconciled"
		verify_cutover_backup_evidence
		return
	else
		status=$?
	fi
	[[ "$status" == 2 ]] && return 2
	return 1
}

verify_cutover_backup_evidence() {
	[[ "$cutover_backup_archive" == "$PRODUCTION_BACKUP_DIR/.cutover-pins/$release/application.dump" ]] ||
		return 1
	[[ "$cutover_backup_receipt" == "${cutover_backup_archive}.restore-verified.json" ]] ||
		return 1
	[[ "$cutover_backup_offsite_archive" == "$PRODUCTION_OFFSITE_DIR/.cutover-pins/$release/application.dump" ]] ||
		return 1
	[[ "$cutover_backup_offsite_receipt" == "${cutover_backup_offsite_archive}.restore-verified.json" ]] ||
		return 1
	verify_backup_pair \
		"$cutover_backup_archive" \
		"$cutover_backup_receipt" \
		"$production_source_identity" \
		"$production_restore_identity" \
		migrated-veud-v1 &&
		verify_backup_pair \
			"$cutover_backup_offsite_archive" \
			"$cutover_backup_offsite_receipt" \
			"$production_source_identity" \
			"$production_restore_identity" \
			migrated-veud-v1
}

remove_production_cutover_authority() {
	# The maintenance marker is the stronger authority whenever both records
	# coexist. Publish completion by removing it last so an interruption can
	# never leave a preparation-only state behind.
	cutover_remove_file_durable "$preparation_state"
	cutover_remove_file_durable "$maintenance_state"
}

restore_writer_services() {
	local unit result=0
	for unit in "${writer_services[@]}"; do
		if [[ "${original_unit_states[$unit]}" == active ]]; then
			# Waiting here gives oneshot jobs a definitive success/failure result.
			systemctl --user start "$unit" || result=1
		else
			systemctl --user stop "$unit" || result=1
		fi
	done
	return "$result"
}

restore_writer_timers() {
	local unit result=0
	for unit in "${writer_timers[@]}"; do
		if [[ "${original_unit_states[$unit]}" == active ]]; then
			systemctl --user start "$unit" || result=1
		else
			systemctl --user stop "$unit" || result=1
		fi
	done
	return "$result"
}

disable_writer_timers() {
	local unit
	for unit in "${writer_timers[@]}"; do
		systemctl --user disable "$unit" >/dev/null
	done
}

restore_writer_enablement() {
	local unit result=0
	for unit in "${writer_timers[@]}"; do
		case "${original_unit_enabled_states[$unit]}" in
			enabled)
				systemctl --user enable "$unit" >/dev/null || result=1
				;;
			enabled-runtime)
				systemctl --user enable --runtime "$unit" >/dev/null || result=1
				;;
			disabled)
				systemctl --user disable "$unit" >/dev/null || result=1
				;;
			*)
				printf 'Unsupported recorded timer enablement for %s: %s\n' \
					"$unit" "${original_unit_enabled_states[$unit]}" >&2
				result=1
				;;
		esac
	done
	return "$result"
}

verify_enabled_states_unchanged() {
	local unit current_enabled result=0
	for unit in "${all_writer_units[@]}"; do
		current_enabled="$(
			systemctl --user is-enabled "$unit" 2>/dev/null || true
		)"
		if [[ "$current_enabled" != "${original_unit_enabled_states[$unit]}" ]]; then
			printf 'Writer unit enablement changed during maintenance: %s\n' \
				"$unit" >&2
			result=1
		fi
	done
	return "$result"
}

verify_writer_service_states() {
	local allow_timer_catchup="${1:-false}"
	local unit timer expected state result_state timer_expected result=0
	for unit in "${writer_services[@]}"; do
		expected="${original_unit_states[$unit]}"
		state="$(systemctl --user show --property=ActiveState --value "$unit")"
		timer="${unit%.service}.timer"
		timer_expected="${original_unit_states[$timer]:-inactive}"
		result_state="$(systemctl --user show --property=Result --value "$unit")"
		if cutover_service_state_matches \
			"$expected" \
			"$state" \
			"$result_state" \
			true \
			"$allow_timer_catchup" \
			"$timer_expected" \
			false; then
			continue
		fi
		printf 'Writer service runtime state was not restored: %s (%s, expected %s)\n' \
			"$unit" "$state" "$expected" >&2
		result=1
	done
	return "$result"
}

verify_writer_timer_states() {
	local unit expected state result=0
	for unit in "${writer_timers[@]}"; do
		expected="${original_unit_states[$unit]}"
		state="$(systemctl --user show --property=ActiveState --value "$unit")"
		if [[ "$state" != "$expected" ]]; then
			printf 'Writer timer runtime state was not restored: %s (%s, expected %s)\n' \
				"$unit" "$state" "$expected" >&2
			result=1
		fi
	done
	return "$result"
}

verify_pm2_runtime_states() {
	local web_state backup_state backup_exit result=0
	web_state="$(pm2_process_state veud)" || web_state=unknown
	backup_state="$(pm2_process_state veud-backup)" || backup_state=unknown
	if [[ "$web_state" != "$original_pm2_veud_state" ]]; then
		printf 'PM2 web state was not restored: %s (expected %s)\n' \
			"$web_state" "$original_pm2_veud_state" >&2
		result=1
	fi
	if [[ "$backup_state" != "$original_pm2_backup_state" ]]; then
		if [[ "$original_pm2_backup_state" == online &&
			"$backup_state" == stopped ]]; then
			backup_exit="$(pm2_process_exit_code veud-backup 2>/dev/null || true)"
			if [[ "$backup_exit" != 0 ]]; then
				printf 'PM2 backup completed with an unsuccessful exit: %s\n' \
					"$backup_exit" >&2
				result=1
			fi
		else
			printf 'PM2 backup state was not restored: %s (expected %s)\n' \
				"$backup_state" "$original_pm2_backup_state" >&2
			result=1
		fi
	fi
	return "$result"
}

# A maintenance window normally presumes a running system, because the state
# captured at entry is what a failure restores to. A recovery deployment is the
# opposite case, and it was previously impossible: when the activated release
# cannot satisfy the current launcher contract, nothing can bring the web process
# online, and the only tool able to replace that release refused to start. That
# turned a configuration mistake into an outage no command could clear. Allow it
# behind an explicit typed confirmation so it can never happen by accident.
assert_web_state_allows_new_window() {
	local observed="$1" confirmation="${2-}"
	[[ "$observed" != online ]] || return 0
	[[ "$confirmation" == RECOVER_VEUD_PRODUCTION ]] ||
		die "The production web process must be online before a new maintenance window (found ${observed}). If the activated release cannot start, only a recovery deployment can replace it: re-run with VEUD_PRODUCTION_RECOVERY_DEPLOY=RECOVER_VEUD_PRODUCTION"
	printf 'Recovery deployment over an outage: the web process is %s, so this window targets online rather than restoring it.\n' \
		"$observed"
}

quiesce_writers_after_mutation() {
	local unit name state enabled script_path result=0
	for unit in "${writer_timers[@]}"; do
		systemctl --user stop "$unit" >/dev/null 2>&1 || result=1
		systemctl --user disable "$unit" >/dev/null 2>&1 || result=1
	done
	for unit in "${writer_services[@]}"; do
		systemctl --user stop "$unit" >/dev/null 2>&1 || result=1
	done
	for name in veud veud-backup; do
		state="$(pm2_process_state "$name" 2>/dev/null)" || state=unknown
		if [[ "$state" != absent && "$state" != stopped ]]; then
			"$pm2_bin" stop "$name" >/dev/null 2>&1 || result=1
		fi
	done
	acquire_writer_lifetime_lock_exclusive || result=1
	save_pm2_state >/dev/null 2>&1 || result=1

	for unit in "${writer_timers[@]}"; do
		state="$(systemctl --user show --property=ActiveState --value "$unit")"
		enabled="$(systemctl --user is-enabled "$unit" 2>/dev/null || true)"
		[[ "$state" == inactive && "$enabled" == disabled ]] || result=1
	done
	for unit in "${writer_services[@]}"; do
		state="$(systemctl --user show --property=ActiveState --value "$unit")"
		[[ "$state" == inactive || "$state" == failed ]] || result=1
	done
	for name in veud veud-backup; do
		state="$(pm2_process_state "$name" 2>/dev/null)" || state=unknown
		[[ "$state" == absent || "$state" == stopped ]] || result=1
		if [[ "$state" != absent ]]; then
			script_path="$(pm2_process_script_path "$name" 2>/dev/null)" ||
				script_path=''
			case "$name:$script_path" in
			"veud:$destination/ops/local-production/run-app.sh") ;;
			"veud-backup:$destination/ops/local-production/run-backup.sh") ;;
			*) result=1 ;;
			esac
		fi
	done
	return "$result"
}

restore_before_mutation_best_effort() {
	local restored=true
	write_maintenance_state restore-before-mutation >/dev/null 2>&1 ||
		restored=false

	if ! restore_original_unit_definitions; then
		write_maintenance_state restoration-failed >/dev/null 2>&1 || true
		printf '%s\n' \
			'Original production unit definitions could not be restored; all writers remain blocked.' \
			>&2
		return
	fi
	release_provider_locks
	release_writer_lifetime_lock
	if ! restore_original_pm2_definitions; then
		restored=false
	fi

	if ! restore_writer_services; then
		restored=false
	fi
	if ! verify_writer_service_states false; then
		restored=false
	fi
	if ! restore_writer_enablement; then
		restored=false
	fi
	if ! restore_writer_timers; then
		restored=false
	fi
	if ! verify_writer_timer_states; then
		restored=false
	fi
	if ! verify_enabled_states_unchanged; then
		restored=false
	fi
	if ! verify_pm2_runtime_states; then
		restored=false
	fi

	if [[ "$restored" == true ]]; then
		if write_production_completion_cleanup_state; then
			remove_production_cutover_authority
			cleanup_completed_production_release ||
				printf '%s\n' \
					'Production restoration succeeded; deferred cleanup remains journaled.' \
					>&2
		else
			restored=false
		fi
	fi
	if [[ "$restored" != true ]]; then
		write_maintenance_state restoration-failed >/dev/null 2>&1 || true
		printf '%s\n' \
			'Writer-state restoration was incomplete; the production maintenance marker was retained.' \
			>&2
	fi
}

recover_production_cutover_failure() {
	local exit_status="$1"
	if [[ "$deployment_succeeded" != true && "$maintenance_started" == true ]]; then
		if [[ "$database_mutation_started" == true ]]; then
			if ! write_maintenance_state blocking-after-database-mutation \
				>/dev/null 2>&1; then
				write_production_emergency_block ||
					die 'Unable to publish either production blocking authority'
			fi
			if quiesce_writers_after_mutation; then
				write_maintenance_state failed-after-database-mutation >/dev/null 2>&1 ||
					true
				printf '%s\n' \
					'Production remains in maintenance: database mutation began before deployment completed. All web, worker, timer, and backup starts were verified stopped and disabled; rerun this deploy to recover.' \
					>&2
			else
				write_maintenance_state quiescence-verification-failed >/dev/null 2>&1 ||
					true
				printf '%s\n' \
					'Production remains in blocking maintenance, but complete writer quiescence could not be verified. Inspect PM2 and systemd before recovery.' \
					>&2
			fi
			release_provider_locks
		else
			restore_before_mutation_best_effort
		fi
	elif [[ "$deployment_succeeded" != true &&
		"$preparation_started" == true ]]; then
		if restore_original_pm2_definitions &&
			verify_pm2_runtime_states; then
			cutover_remove_file_durable "$preparation_state"
			rm -rf "$state_dir"
		else
			printf '%s\n' \
				'Production supervisor preparation could not be restored; rerun the same release deploy.' \
				>&2
		fi
	elif [[ "$deployment_succeeded" != true &&
		"$maintenance_preexisting" == true &&
		"$maintenance_loaded" != true ]]; then
		printf '%s\n' \
			'The existing production maintenance marker could not be validated and was left untouched.' \
			>&2
	fi
}

production_handle_injected_failure() {
	local exit_status="$1"
	set +e
	recover_production_cutover_failure "$exit_status"
	transition_failure_handled=true
	set -e
	return 0
}

cleanup() {
	local exit_status=$?
	trap - EXIT
	set +e
	rm -rf "$partial" "$current_next"
	rm -f "${maintenance_state}.tmp-$$" "${preparation_state}.tmp-$$"
	rm -f "$pm2_restore_tmp"
	if [[ "$transition_failure_handled" != true ]]; then
		recover_production_cutover_failure "$exit_status"
	fi
	release_provider_locks

	exit "$exit_status"
}
trap cleanup EXIT

grep -q 'catalogProvenanceVersion' \
	"$REPO_ROOT/prisma/postgresql/schema.prisma" ||
	die 'Refusing to deploy a provenance-incomplete PostgreSQL schema'

cutover_acquire_deployment_lock \
	"$PRODUCTION_ROOT/run/catalog-release-deploy.lock" \
	'Another production catalog deployment is already running'
cleanup_completed_production_release
for existing_state in "$maintenance_state" "$preparation_state"; do
	if [[ -e "$existing_state" || -L "$existing_state" ]]; then
		[[ -f "$existing_state" && ! -L "$existing_state" ]] ||
			die "Production cutover authority is not a regular non-symlink file: $existing_state"
		[[ "$(read_catalog_cutover_marker_value "$existing_state" format)" == 2 &&
			"$(read_catalog_cutover_marker_value "$existing_state" environment)" == production &&
			"$(read_catalog_cutover_marker_value "$existing_state" requested_release)" == "$release" ]] ||
			die 'Existing production cutover state belongs to another release or format'
	fi
done
if [[ -e "$emergency_block_state" || -L "$emergency_block_state" ]]; then
	[[ -f "$emergency_block_state" && ! -L "$emergency_block_state" ]] ||
		die 'Production emergency block authority is not a regular non-symlink file'
	[[ "$(read_catalog_cutover_marker_value "$emergency_block_state" format)" == 1 &&
		"$(read_catalog_cutover_marker_value "$emergency_block_state" environment)" == production &&
		"$(read_catalog_cutover_marker_value "$emergency_block_state" requested_release)" == "$release" ]] ||
		die 'Existing production emergency block belongs to another release or format'
fi
mkdir -p "$releases_root"

if [[ ! -d "$destination" ]]; then
	mkdir -p "$partial"
	git archive "$release" | tar -x -C "$partial"
	(
		cd "$partial"
		export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
		"$NPM_BIN" ci --include=dev
		"$NPM_BIN" run prisma:generate:postgres
		"$NPM_BIN" run build
	)
	printf '%s\n' "$release" >"$partial/RELEASE"
	cutover_publish_tree_durable "$partial" "$destination"
fi

[[ "$(cat "$destination/RELEASE")" == "$release" ]] ||
	die 'Immutable release marker does not match the requested revision'
[[ -x "$destination/node_modules/.bin/tsx" && -x "$pm2_bin" ]] ||
	die 'Immutable release dependencies are incomplete'
for required_file in \
	"$destination/scripts/backup-postgres.mjs" \
	"$destination/scripts/quarantine-media-catalog-provenance.ts" \
	"$destination/scripts/sync-watchlist-metadata.ts" \
	"$destination/ops/catalog-cutover-common.sh" \
	"$destination/ops/local-production/run-app.sh" \
	"$destination/ops/local-production/run-backup.sh" \
	"$destination/build/server/index.js" \
	"$destination/server-build/index.js" \
	"$destination/server-build/shutdown.js" \
	"$destination/prisma/postgresql/schema.prisma"; do
	[[ -f "$required_file" ]] ||
		die "Immutable release is missing a cutover dependency: $required_file"
done
[[ -d "$destination/build/client/assets" ]] ||
	die 'Immutable release is missing compiled client assets'
for schema in \
	"$destination/prisma/postgresql/schema.prisma" \
	"$destination/node_modules/.prisma/client/schema.prisma"; do
	grep -q 'catalogProvenanceVersion' "$schema" ||
		die "Immutable release does not contain the catalog provenance epoch: $schema"
done
grep -Eq 'provider[[:space:]]*=[[:space:]]*"postgresql"' \
	"$destination/node_modules/.prisma/client/schema.prisma" ||
	die 'Refusing to package dependencies without a PostgreSQL Prisma client'
grep -q -- '--require-clean' \
	"$destination/scripts/quarantine-media-catalog-provenance.ts" ||
	die 'Immutable release does not contain the provenance completion guard'
for required_unit in "${all_writer_units[@]}"; do
	[[ -f "$destination/ops/local-production/systemd/$required_unit" ]] ||
		die "Immutable release is missing a production cutover unit: $required_unit"
done
for required_launcher in \
	"$destination"/ops/local-production/run-*.sh; do
	[[ -x "$required_launcher" ]] ||
		die "Immutable production launcher is not executable: $required_launcher"
done

# Resolve and verify the exact production identity before entering maintenance.
load_production_worker_environment
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
assert_production_backup_database_identities
production_source_identity="$(production_database_identity)"
production_restore_identity="$(
	cd "$destination"
	POSTGRES_BACKUP_VERIFY_URL="$POSTGRES_BACKUP_VERIFY_URL" \
		"$NODE_BIN" --input-type=module -e '
			import {
				parsePostgresConnection,
				postgresConnectionIdentity,
			} from "./scripts/postgres-backup-utils.mjs"
			const restore = parsePostgresConnection(
				process.env.POSTGRES_BACKUP_VERIFY_URL,
				"POSTGRES_BACKUP_VERIFY_URL",
			)
			process.stdout.write(postgresConnectionIdentity(restore))
		'
)"
[[ "$production_source_identity" == '127.0.0.1:5433/veud_production' &&
	"$production_restore_identity" == '127.0.0.1:5433/veud_production_restore' ]] ||
	die 'Production backup source or restore identity is outside the fixed boundary'
verify_active_release

if [[ -f "$maintenance_state" ]]; then
	maintenance_preexisting=true
	load_maintenance_state
	printf 'Resuming the recorded production maintenance window for %s.\n' \
		"$original_active_release"
elif [[ -f "$preparation_state" ]]; then
	load_maintenance_state "$preparation_state"
	maintenance_started=false
	preparation_started=true
	printf 'Resuming production supervisor preparation for %s.\n' \
		"$original_active_release"
else
	original_active_release="$(cat "$APP_ROOT/RELEASE")"
	[[ "$original_active_release" =~ ^[0-9a-f]{40}$ ]] ||
		die 'The active production release marker is invalid'
	original_pm2_veud_state="$(pm2_process_state veud)"
	original_pm2_backup_state="$(pm2_process_state veud-backup)"
	assert_web_state_allows_new_window \
		"$original_pm2_veud_state" \
		"${VEUD_PRODUCTION_RECOVERY_DEPLOY:-}"
	# Record the target end state, not the outage: every later restore path and
	# the final runtime verification compare against this value, so a recovery
	# window must aim at a running web process.
	original_pm2_veud_state=online
	[[ "$original_pm2_backup_state" == online ||
		"$original_pm2_backup_state" == stopped ]] ||
		die 'The production backup process must be installed and healthy before deployment'
	for unit in "${all_writer_units[@]}"; do
		original_unit_states["$unit"]="$(systemd_active_state "$unit")"
		original_unit_enabled_states["$unit"]="$(
			systemctl --user is-enabled "$unit" 2>/dev/null || true
		)"
		# `is-enabled` prints nothing for a unit this host has never installed.
		# Record it as disabled so a newly shipped writer unit is installed by
		# this deployment and left switched off, which is the only safe default:
		# enabling a job that deletes data on a timer is a deliberate decision,
		# not a side effect of a deployment.
		if [[ -z "${original_unit_enabled_states[$unit]}" ]]; then
			original_unit_enabled_states["$unit"]=disabled
		fi
		[[ "${original_unit_enabled_states[$unit]}" =~ ^[a-z-]+$ ]] ||
			die "Unable to record the enabled state for $unit"
		if is_writer_timer "$unit"; then
			case "${original_unit_enabled_states[$unit]}" in
				enabled | enabled-runtime | disabled) ;;
				*)
					die "Writer timer $unit has unsupported enablement state: ${original_unit_enabled_states[$unit]}"
					;;
			esac
			fi
		done
		rm -rf "$state_dir"
		capture_unit_definitions
		verify_captured_unit_definitions ||
			die 'Unable to durably capture the original production unit definitions'
		capture_original_pm2_definitions
		write_maintenance_state preparing-supervisors "$preparation_state"
	preparation_started=true
fi

if [[ "$database_mutation_started" == true ]]; then
	verify_cutover_backup_evidence ||
		die 'Recorded pre-mutation production backup evidence is missing or invalid'
fi

production_stop_and_drain() {
if [[ ! -f "$maintenance_state" ]]; then
	# No durable maintenance marker is published while legacy PM2 definitions
	# could still be resurrected. Save them stopped first, then publish the
	# marker and replace them with guarded immutable definitions.
		stop_pm2_process veud
		stop_pm2_process veud-backup
		remove_pm2_boot_definitions
		maintenance_loaded=true
		maintenance_started=true
		write_maintenance_state draining-writers
		install_guarded_pm2_definitions
	cutover_remove_file_durable "$preparation_state"
	preparation_started=false
else
	# A retry may have failed during an allowed resume phase. Block every new
	# launcher before touching live state again.
	release_activated=false
	write_maintenance_state draining-writers
	stop_pm2_process veud
	stop_pm2_process veud-backup
	save_pm2_state
	install_guarded_pm2_definitions
fi

release_activated=false
# Stop timer triggers first, then all in-flight systemd writers.
for unit in "${writer_timers[@]}"; do
	stop_writer_unit "$unit"
done
disable_writer_timers
for unit in "${writer_services[@]}"; do
	stop_writer_unit "$unit"
done
write_maintenance_state systemd-writers-stopped
install_immutable_writer_unit_definitions
acquire_writer_lifetime_lock_exclusive ||
	die 'Unable to acquire the production writer lifetime lock'

# Provider locks drain manually launched MAL/TMDB jobs and close the race
# between stopping their systemd services and the database boundary.
exec 8>"$PRODUCTION_ROOT/run/mal-provider.lock"
exec 9>"$PRODUCTION_ROOT/run/tmdb-provider.lock"
locks_held=true
lock_wait_seconds="${VEUD_PRODUCTION_DEPLOY_LOCK_WAIT_SECONDS:-120}"
[[ "$lock_wait_seconds" =~ ^[1-9][0-9]*$ ]] ||
	die 'VEUD_PRODUCTION_DEPLOY_LOCK_WAIT_SECONDS must be a positive integer'
flock --exclusive --wait "$lock_wait_seconds" 8 ||
	die 'Timed out draining the MAL catalog worker'
flock --exclusive --wait "$lock_wait_seconds" 9 ||
	die 'Timed out draining the TMDB catalog worker'

write_maintenance_state all-writers-stopped
}

production_backup_or_verify() {
local reconcile_status
# This is the last pre-mutation gate. The backup script performs a fresh
# pg_dump, restores it into the isolated verification database, records a
# receipt, and verifies the configured independent copy.
if [[ "$database_mutation_started" == false ]]; then
	write_maintenance_state backup-before-mutation
	if reconcile_cutover_backup_evidence; then
		:
	else
		reconcile_status=$?
		[[ "$reconcile_status" == 2 ]] ||
			die 'Existing production backup pins are incomplete or invalid'
		create_and_pin_cutover_backup \
			"$PRODUCTION_BACKUP_DIR" \
			"$PRODUCTION_OFFSITE_DIR" \
			application \
			env \
			DATABASE_URL="$DATABASE_URL" \
			BACKUP_SOURCE_POLICY=migrated-veud-v1 \
			"$NODE_BIN" "$destination/scripts/backup-postgres.mjs"
	fi
else
	verify_cutover_backup_evidence ||
		die 'Recorded pre-mutation production backup evidence is missing or invalid'
fi
write_maintenance_state backup-verified
}

production_mutate() {
# Persist the point-of-no-return immediately before the first schema mutation.
write_production_emergency_block
database_mutation_started=true
write_maintenance_state migrating
(
	cd "$destination"
	DATABASE_URL="$DATABASE_URL" "$destination/node_modules/.bin/prisma" \
		migrate deploy \
		--schema="$destination/prisma/postgresql/schema.prisma"
	DATABASE_URL="$DATABASE_URL" "$NPM_BIN" run db:verify:postgres
	DATABASE_URL="$DATABASE_URL" "$destination/node_modules/.bin/tsx" \
		"$destination/scripts/quarantine-media-catalog-provenance.ts" \
		--batch-size 100
	DATABASE_URL="$DATABASE_URL" "$destination/node_modules/.bin/tsx" \
		"$destination/scripts/quarantine-media-catalog-provenance.ts" \
		--commit \
		--confirm QUARANTINE_UNTRUSTED_MEDIA_CATALOG \
		--batch-size 100
	DATABASE_URL="$DATABASE_URL" "$destination/node_modules/.bin/tsx" \
		"$destination/scripts/backfill-next-release-at.ts" \
		--commit
	DATABASE_URL="$DATABASE_URL" "$destination/node_modules/.bin/tsx" \
		"$destination/scripts/sync-watchlist-metadata.ts" \
		--commit \
		--batch-size 100
	DATABASE_URL="$DATABASE_URL" "$destination/node_modules/.bin/tsx" \
		"$destination/scripts/quarantine-media-catalog-provenance.ts" \
		--batch-size 100 \
		--require-clean
)
write_maintenance_state database-compatible
}

production_activate_and_health() {
ln -s "$destination" "$current_next"
cutover_publish_symlink_durable "$current_next" "$current"
write_maintenance_state healthcheck-compatible-release
# The application must acquire the same shared lifetime lock as every normal
# launcher. Its marker phase is the only start permitted while the cutover is
# incomplete; failures stop it and drain this lock again before quiescence is
# reported.
cutover_remove_file_durable "$emergency_block_state"
release_writer_lifetime_lock

# Replace the stopped process definition so PM2 cannot retain the old release
# cwd. The follow-up update supplies the exact archive revision because an
# exported git archive intentionally has no .git directory.
if [[ "$(pm2_process_state veud)" != absent ]]; then
	"$pm2_bin" delete veud
fi
(
	cd "$destination"
	NODE_ENV=production "$pm2_bin" start ecosystem.config.cjs \
		--only veud \
		--env production \
		--update-env
)
NODE_ENV=production \
	VEUD_ENVIRONMENT=production \
	VEUD_RELEASE="$release" \
	HOST=127.0.0.1 \
	PORT=4021 \
	"$pm2_bin" restart veud --update-env

health_attempts="${VEUD_PRODUCTION_HEALTHCHECK_ATTEMPTS:-30}"
[[ "$health_attempts" =~ ^[1-9][0-9]*$ ]] ||
	die 'VEUD_PRODUCTION_HEALTHCHECK_ATTEMPTS must be a positive integer'
health_ready=false
health_headers="$state_dir/production-health.headers"
for ((attempt = 1; attempt <= health_attempts; attempt++)); do
	web_state="$(pm2_process_state veud)"
	if [[ "$web_state" == online ]] &&
		cutover_isolated_health_request \
			"$health_headers" \
			"http://127.0.0.1:4021/resources/healthcheck"; then
		if cutover_health_headers_match \
			"$health_headers" \
			"$release" \
			production; then
			health_ready=true
			break
		fi
	fi
	[[ "$web_state" != errored && "$web_state" != stopped ]] ||
		break
	sleep 1
done
[[ "$health_ready" == true ]] ||
	die 'The compatible production release did not pass its local healthcheck'
release_activated=true
write_maintenance_state release-healthy

# Keep the active release plus the two newest rollback candidates. A release is
# removable only when it is a direct child with an immutable RELEASE marker.
mapfile -t packaged_releases < <(
	find "$releases_root" \
		-mindepth 1 \
		-maxdepth 1 \
		-type d \
		! -name '.*' \
		-printf '%T@ %p\n' |
		sort -nr |
		cut -d' ' -f2-
)
for old_release in "${packaged_releases[@]:3}"; do
	[[ "$old_release" == "$releases_root/"* ]] || continue
	[[ -f "$old_release/RELEASE" ]] || continue
	[[ "$old_release" != "$destination" ]] || continue
	rm -rf -- "$old_release"
done
}

production_restore() {
# Only compatible code may resume database writers. Release provider locks
# before restoring the exact service/timer active set captured at entry.
write_maintenance_state resume-writers
release_provider_locks
release_writer_lifetime_lock
restore_writer_services
verify_writer_service_states false
restore_writer_enablement
restore_writer_timers
verify_writer_timer_states
verify_enabled_states_unchanged
cutover_sync_tree "$unit_dir"

# Recreate the backup definition from the compatible release last. This also
# takes one post-cutover backup; the one-shot process naturally returns to its
# recorded stopped state between hourly cron runs.
write_maintenance_state resume-backup
if [[ "$(pm2_process_state veud-backup)" != absent ]]; then
	"$pm2_bin" delete veud-backup
fi
(
	cd "$destination"
	NODE_ENV=production "$pm2_bin" start ecosystem.config.cjs \
		--only veud-backup \
		--env production \
		--update-env
)
backup_state=''
if [[ "$original_pm2_backup_state" == stopped ]]; then
	backup_wait_seconds="${VEUD_PRODUCTION_POST_DEPLOY_BACKUP_WAIT_SECONDS:-900}"
else
	backup_wait_seconds=10
fi
[[ "$backup_wait_seconds" =~ ^[1-9][0-9]*$ ]] ||
	die 'VEUD_PRODUCTION_POST_DEPLOY_BACKUP_WAIT_SECONDS must be a positive integer'
for ((attempt = 1; attempt <= backup_wait_seconds; attempt++)); do
	backup_state="$(pm2_process_state veud-backup)"
	if [[ "$original_pm2_backup_state" == online &&
		("$backup_state" == online || "$backup_state" == stopped) ]]; then
		break
	fi
	[[ "$backup_state" != stopped ]] || break
	[[ "$backup_state" != errored ]] || break
	sleep 1
done
if [[ "$original_pm2_backup_state" == stopped ]]; then
	[[ "$backup_state" == stopped &&
		"$(pm2_process_exit_code veud-backup)" == 0 ]] ||
		die "The post-cutover backup did not complete successfully: $backup_state"
else
	[[ "$backup_state" == online || "$backup_state" == stopped ]] ||
		die "The compatible production backup process did not start cleanly: $backup_state"
fi
save_pm2_state
verify_pm2_runtime_states
verify_writer_service_states true
verify_writer_timer_states
verify_enabled_states_unchanged
}

production_complete() {
deployment_succeeded=true
write_production_completion_cleanup_state
remove_production_cutover_authority
cutover_remove_file_durable "$emergency_block_state"
cleanup_completed_production_release ||
	printf '%s\n' \
		'Production activation succeeded; deferred cleanup remains journaled.' >&2
trap - EXIT
rm -rf "$partial" "$current_next"
printf 'Activated immutable production catalog release %s\n' "$release"
}

cutover_run_transition_driver production
