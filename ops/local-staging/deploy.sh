#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
guard_backup_storage
load_application_environment
application_database_url="$DATABASE_URL"
load_staging_environment
operations_database_url="$DATABASE_URL"
verify_node_22
assert_staging_database_identities \
	"$application_database_url" \
	"$operations_database_url" \
	"$STAGING_LOAD_DATABASE_URL" \
	"$POSTGRES_BACKUP_VERIFY_URL"
export DATABASE_URL="$application_database_url"
require_command awk
require_command curl
[[ -x "${CUTOVER_CURL_BIN:-/usr/bin/curl}" ]] ||
	die 'Health checks require an executable ${CUTOVER_CURL_BIN:-/usr/bin/curl}'
require_command comm
require_command find
require_command flock
require_command git
require_command install
require_command sha256sum
require_command sync
require_command systemctl
require_command tar

umask 077

commit="${1:-HEAD}"
commit="$(git -C "$REPO_ROOT" rev-parse --verify "$commit^{commit}")"
release="$STAGING_ROOT/app/releases/$commit"
temporary="$release.partial-$$"
current="$STAGING_ROOT/app/current"
current_next="$STAGING_ROOT/app/current.next-$$"
unit_state_file="$STAGING_ROOT/run/provenance-cutover-unit-state"
cutover_sentinel="$STAGING_ROOT/run/provenance-cutover-incomplete"
emergency_block_state="$STAGING_ROOT/run/provenance-cutover-emergency-block"
completion_cleanup_state="$STAGING_ROOT/run/provenance-cutover-completion-cleanup"
state_dir="$STAGING_ROOT/run/provenance-cutover-state-$commit"
unit_dir="$HOME/.config/systemd/user"
writer_lifetime_lock="$STAGING_ROOT/run/catalog-writer-lifetime.lock"
phase='prepare-release'
states_recorded=false
staging_stop_and_drain() {
release_activated=false
mutation_started=false
locks_held=false
writer_lifetime_lock_held=false
original_release=''
bootstrap=false
deployment_succeeded=false
transition_failure_handled=false
backup_source_policy=pending
application_backup_archive=''
application_backup_receipt=''
application_backup_offsite_archive=''
application_backup_offsite_receipt=''
load_backup_archive=''
load_backup_receipt=''
load_backup_offsite_archive=''
load_backup_offsite_receipt=''

service_units=(
	veud-staging-app.service
	veud-staging-notification-digests.service
	veud-staging-jikan-anime-cast.service
	veud-staging-mal-hydration.service
	veud-staging-mal-inventory.service
	veud-staging-mal-trending.service
	veud-staging-tmdb-hydration.service
	veud-staging-tmdb-inventory.service
	veud-staging-backup.service
	veud-staging-catalog-backup.service
)
regular_timer_units=(
	veud-staging-notification-digests.timer
	veud-staging-jikan-anime-cast.timer
	veud-staging-mal-hydration.timer
	veud-staging-mal-inventory.timer
	veud-staging-mal-trending.timer
	veud-staging-tmdb-hydration.timer
	veud-staging-tmdb-inventory.timer
)
backup_timer_units=(
	veud-staging-backup.timer
	veud-staging-catalog-backup.timer
)
timer_units=("${regular_timer_units[@]}" "${backup_timer_units[@]}")
all_units=("${service_units[@]}" "${timer_units[@]}")
boot_units=(veud-staging-app.service "${timer_units[@]}")
completion_capable_service_units=(
	veud-staging-jikan-anime-cast.service
	veud-staging-mal-hydration.service
	veud-staging-notification-digests.service
	veud-staging-mal-inventory.service
	veud-staging-mal-trending.service
	veud-staging-tmdb-hydration.service
	veud-staging-tmdb-inventory.service
	veud-staging-backup.service
	veud-staging-catalog-backup.service
)

declare -A prior_active_state=()
declare -A prior_enabled_state=()
declare -A prior_running=()

write_staging_emergency_block() {
	local temporary_state="${emergency_block_state}.tmp-$$"
	if [[ -e "$emergency_block_state" || -L "$emergency_block_state" ]]; then
		[[ -f "$emergency_block_state" && ! -L "$emergency_block_state" ]] ||
			die 'Staging emergency block authority is not a regular non-symlink file'
		[[ "$(read_catalog_cutover_marker_value "$emergency_block_state" format)" == 1 &&
			"$(read_catalog_cutover_marker_value "$emergency_block_state" environment)" == staging &&
			"$(read_catalog_cutover_marker_value "$emergency_block_state" release)" == "$commit" ]] ||
			die 'Staging emergency block authority belongs to another release'
		return 0
	fi
	{
		printf 'format=1\n'
		printf 'environment=staging\n'
		printf 'release=%s\n' "$commit"
		printf 'recorded_at=%s\n' "$(date --iso-8601=seconds)"
	} >"$temporary_state"
	chmod 600 "$temporary_state"
	cutover_publish_file_durable "$temporary_state" "$emergency_block_state"
}

write_staging_completion_cleanup_state() {
	local temporary_state="${completion_cleanup_state}.tmp-$$"
	if [[ -e "$completion_cleanup_state" || -L "$completion_cleanup_state" ]]; then
		[[ -f "$completion_cleanup_state" && ! -L "$completion_cleanup_state" ]] ||
			die 'Staging completion cleanup authority is not a regular non-symlink file'
		[[ "$(read_catalog_cutover_marker_value "$completion_cleanup_state" format)" == 1 &&
			"$(read_catalog_cutover_marker_value "$completion_cleanup_state" environment)" == staging &&
			"$(read_catalog_cutover_marker_value "$completion_cleanup_state" release)" == "$commit" ]] ||
			die 'Staging completion cleanup authority belongs to another release'
		return 0
	fi
	{
		printf 'format=1\n'
		printf 'environment=staging\n'
		printf 'release=%s\n' "$commit"
		printf 'recorded_at=%s\n' "$(date --iso-8601=seconds)"
	} >"$temporary_state"
	chmod 600 "$temporary_state"
	cutover_publish_file_durable "$temporary_state" "$completion_cleanup_state"
}

cleanup_staging_release_artifacts() {
	local cleanup_release="$1" failed=0
	[[ "$cleanup_release" =~ ^[0-9a-f]{40}$ ]] || return 1
	cutover_remove_tree_durable \
		"$STAGING_ROOT/run/provenance-cutover-state-$cleanup_release" ||
		failed=1
	cutover_remove_tree_durable \
		"$BACKUP_DIR/.cutover-pins/$cleanup_release" ||
		failed=1
	cutover_remove_tree_durable \
		"$OFFSITE_DIR/.cutover-pins/$cleanup_release" ||
		failed=1
	cutover_remove_tree_durable \
		"$STAGING_ROOT/backups/catalog/.cutover-pins/$cleanup_release" ||
		failed=1
	cutover_remove_tree_durable \
		"$OFFSITE_DIR/catalog/.cutover-pins/$cleanup_release" ||
		failed=1
	if ((failed == 0)); then
		cutover_remove_file_durable "$unit_state_file"
		return
	fi
	return 1
}

cleanup_completed_staging_release() {
	local completed_release='' active_release='' authority failed=0
	if [[ ! -e "$completion_cleanup_state" && ! -L "$completion_cleanup_state" ]]; then
		return 0
	fi
	[[ -f "$completion_cleanup_state" && ! -L "$completion_cleanup_state" ]] ||
		die 'Staging completion cleanup authority is not a regular non-symlink file'
	[[ "$(read_catalog_cutover_marker_value "$completion_cleanup_state" format)" == 1 &&
		"$(read_catalog_cutover_marker_value "$completion_cleanup_state" environment)" == staging ]] ||
		die 'Staging completion cleanup has an invalid format or environment'
	completed_release="$(
		read_catalog_cutover_marker_value "$completion_cleanup_state" release
	)"
	[[ "$completed_release" =~ ^[0-9a-f]{40}$ ]] ||
		die 'Staging completion cleanup has an invalid release'
	active_release="$(
		cutover_active_release_id "$current" "$STAGING_ROOT/app/releases"
	)" || die 'Staging completion cleanup cannot attest the active release'
	[[ "$active_release" == "$completed_release" ]] ||
		die 'Staging completion cleanup does not match the active release'
	if [[ -e "$cutover_sentinel" || -L "$cutover_sentinel" ]]; then
		[[ -f "$cutover_sentinel" && ! -L "$cutover_sentinel" ]] ||
			die 'Staging completion cleanup found malformed cutover authority'
		[[ "$(read_catalog_cutover_marker_value "$cutover_sentinel" format)" == 2 &&
			"$(read_catalog_cutover_marker_value "$cutover_sentinel" environment)" == staging &&
			"$(read_catalog_cutover_marker_value "$cutover_sentinel" release)" == "$completed_release" ]] ||
			die 'Staging completion cleanup found foreign cutover authority'
	fi
	authority="$emergency_block_state"
	if [[ -e "$authority" || -L "$authority" ]]; then
		[[ -f "$authority" && ! -L "$authority" ]] ||
			die 'Staging completion cleanup found malformed emergency authority'
		[[ "$(read_catalog_cutover_marker_value "$authority" format)" == 1 &&
			"$(read_catalog_cutover_marker_value "$authority" environment)" == staging &&
			"$(read_catalog_cutover_marker_value "$authority" release)" == "$completed_release" ]] ||
			die 'Staging completion cleanup found foreign emergency authority'
	fi
	cutover_remove_file_durable "$cutover_sentinel" || failed=1
	cutover_remove_file_durable "$emergency_block_state" || failed=1
	cleanup_staging_release_artifacts "$completed_release" || failed=1
	if ((failed == 0)); then
		cutover_remove_file_durable "$completion_cleanup_state"
		return
	fi
	return 1
}

discard_orphaned_staging_unit_state() {
	local orphan_release=''
	[[ -f "$unit_state_file" ]] || return 0
	# The sentinel is the sole incomplete-cutover authority. A unit-state file
	# can outlive it if the process stops between crash-safe completion
	# publication and housekeeping. Never let that harmless release-A orphan
	# pin a later release B, and never derive a removal path from malformed
	# content.
	orphan_release="$(
		awk -F= '
			$1 == "# release" { count += 1; value = $2 }
			END { if (count == 1) print value }
		' "$unit_state_file"
	)"
	if [[ "$orphan_release" =~ ^[0-9a-f]{40}$ ]]; then
		cleanup_staging_release_artifacts "$orphan_release"
		return
	fi
	cutover_remove_file_durable "$unit_state_file"
}

release_provider_locks() {
	if [[ "$locks_held" == true ]]; then
		exec 8>&-
		exec 9>&-
		exec 10>&-
		locks_held=false
	fi
}

verify_backup_pair() {
	cutover_verify_backup_pair "$NODE_BIN" "$@"
}

create_and_pin_cutover_backup() {
	local backup_dir="$1" offsite_dir="$2" label="$3"
	shift 3
	local pinned_archive pinned_receipt pinned_offsite pinned_offsite_receipt
	local expected_source expected_restore='127.0.0.1:5433/veud_staging_restore'
	case "$label" in
	application) expected_source='127.0.0.1:5433/veud_staging' ;;
	load) expected_source='127.0.0.1:5433/veud_staging_load' ;;
	*) die "Unknown cutover backup label: $label" ;;
	esac
	IFS=$'\t' read -r \
		pinned_archive \
		pinned_receipt \
		pinned_offsite \
		pinned_offsite_receipt < <(
		cutover_create_and_pin_backup \
			"$NODE_BIN" \
			"$state_dir" \
			"$backup_dir" \
			"$offsite_dir" \
			"$backup_dir/.cutover-pins/$commit" \
			"$offsite_dir/.cutover-pins/$commit" \
			"$label" \
			"$expected_source" \
			"$expected_restore" \
			"$backup_source_policy" \
			"$@"
	)
	case "$label" in
	application)
		application_backup_archive="$pinned_archive"
		application_backup_receipt="$pinned_receipt"
		application_backup_offsite_archive="$pinned_offsite"
		application_backup_offsite_receipt="$pinned_offsite_receipt"
		;;
	load)
		load_backup_archive="$pinned_archive"
		load_backup_receipt="$pinned_receipt"
		load_backup_offsite_archive="$pinned_offsite"
		load_backup_offsite_receipt="$pinned_offsite_receipt"
		;;
	esac
	verify_cutover_backup_evidence "$label"
}

reconcile_cutover_backup_evidence() {
	local label="$1" backup_dir offsite_dir expected_source
	local pin_root offsite_pin_root reconciled status
	local expected_restore='127.0.0.1:5433/veud_staging_restore'
	case "$label" in
	application)
		backup_dir="$BACKUP_DIR"
		offsite_dir="$OFFSITE_DIR"
		expected_source='127.0.0.1:5433/veud_staging'
		;;
	load)
		backup_dir="$STAGING_ROOT/backups/catalog"
		offsite_dir="$OFFSITE_DIR/catalog"
		expected_source='127.0.0.1:5433/veud_staging_load'
		;;
	*) return 1 ;;
	esac
	pin_root="$backup_dir/.cutover-pins/$commit"
	offsite_pin_root="$offsite_dir/.cutover-pins/$commit"
	if reconciled="$(
		cutover_reconcile_backup_pins \
			"$NODE_BIN" \
			"$backup_dir" \
			"$offsite_dir" \
			"$pin_root" \
			"$offsite_pin_root" \
			"$label" \
			"$expected_source" \
			"$expected_restore" \
			"$backup_source_policy"
	)"; then
		case "$label" in
		application)
			IFS=$'\t' read -r \
				application_backup_archive \
				application_backup_receipt \
				application_backup_offsite_archive \
				application_backup_offsite_receipt <<<"$reconciled"
			;;
		load)
			IFS=$'\t' read -r \
				load_backup_archive \
				load_backup_receipt \
				load_backup_offsite_archive \
				load_backup_offsite_receipt <<<"$reconciled"
			;;
		esac
		verify_cutover_backup_evidence "$label"
		return
	else
		status=$?
	fi
	[[ "$status" == 2 ]] && return 2
	return 1
}

verify_cutover_backup_evidence() {
	local label="${1:-all}"
	if [[ "$label" == application || "$label" == all ]]; then
		[[ "$application_backup_archive" == "$BACKUP_DIR/.cutover-pins/$commit/application.dump" &&
			"$application_backup_receipt" == "${application_backup_archive}.restore-verified.json" &&
			"$application_backup_offsite_archive" == "$OFFSITE_DIR/.cutover-pins/$commit/application.dump" &&
			"$application_backup_offsite_receipt" == "${application_backup_offsite_archive}.restore-verified.json" ]] ||
			return 1
		verify_backup_pair \
			"$application_backup_archive" \
			"$application_backup_receipt" \
			'127.0.0.1:5433/veud_staging' \
			'127.0.0.1:5433/veud_staging_restore' \
			"$backup_source_policy" ||
			return 1
		verify_backup_pair \
			"$application_backup_offsite_archive" \
			"$application_backup_offsite_receipt" \
			'127.0.0.1:5433/veud_staging' \
			'127.0.0.1:5433/veud_staging_restore' \
			"$backup_source_policy" ||
			return 1
	fi
	if [[ "$label" == load || "$label" == all ]]; then
		[[ "$load_backup_archive" == "$STAGING_ROOT/backups/catalog/.cutover-pins/$commit/load.dump" &&
			"$load_backup_receipt" == "${load_backup_archive}.restore-verified.json" &&
			"$load_backup_offsite_archive" == "$OFFSITE_DIR/catalog/.cutover-pins/$commit/load.dump" &&
			"$load_backup_offsite_receipt" == "${load_backup_offsite_archive}.restore-verified.json" ]] ||
			return 1
		verify_backup_pair \
			"$load_backup_archive" \
			"$load_backup_receipt" \
			'127.0.0.1:5433/veud_staging_load' \
			'127.0.0.1:5433/veud_staging_restore' \
			"$backup_source_policy" ||
			return 1
		verify_backup_pair \
			"$load_backup_offsite_archive" \
			"$load_backup_offsite_receipt" \
			'127.0.0.1:5433/veud_staging_load' \
			'127.0.0.1:5433/veud_staging_restore' \
			"$backup_source_policy" ||
			return 1
	fi
}

is_completion_capable_service_unit() {
	local candidate="$1" unit
	for unit in "${completion_capable_service_units[@]}"; do
		[[ "$candidate" == "$unit" ]] && return 0
	done
	return 1
}

is_cutover_unit() {
	local candidate="$1" unit
	for unit in "${all_units[@]}"; do
		[[ "$candidate" == "$unit" ]] && return 0
	done
	return 1
}

active_staging_release_id() {
	cutover_active_release_id "$current" "$STAGING_ROOT/app/releases" ||
		die 'The current staging release identity is invalid'
}

acquire_writer_lifetime_lock_exclusive() {
	local wait_seconds="${VEUD_STAGING_DEPLOY_LOCK_WAIT_SECONDS:-120}"
	if [[ ! "$wait_seconds" =~ ^[1-9][0-9]*$ ]]; then
		printf '%s\n' \
			'VEUD_STAGING_DEPLOY_LOCK_WAIT_SECONDS must be a positive integer' >&2
		return 1
	fi
	if [[ "$writer_lifetime_lock_held" == true ]]; then
		return 0
	fi
	exec 6>"$writer_lifetime_lock"
	if ! flock --exclusive --wait "$wait_seconds" 6; then
		printf '%s\n' 'Timed out draining supported staging database writers' >&2
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
	cutover_capture_unit_definitions "$state_dir" "$unit_dir" "${all_units[@]}"
}

install_immutable_cutover_unit_definitions() {
	cutover_install_immutable_units \
		"$state_dir" \
		"$unit_dir" \
		"$release/ops/local-staging/systemd" \
		'%h/Programs/Veud/ops/local-staging' \
		"$release/ops/local-staging" \
		"${all_units[@]}"
}

restore_original_unit_definitions() {
	cutover_restore_unit_definitions "$state_dir" "$unit_dir" "${all_units[@]}"
}

verify_captured_unit_definitions() {
	cutover_verify_captured_unit_definitions "$state_dir" "${all_units[@]}"
}

write_cutover_sentinel() {
	local exit_status="${1:-0}"
	local temporary_sentinel="$cutover_sentinel.tmp-$$"
	{
		printf 'format=2\n'
		printf 'environment=staging\n'
		printf 'release=%s\n' "$commit"
		printf 'original_release=%s\n' "$original_release"
		printf 'bootstrap=%s\n' "$bootstrap"
		printf 'backup_source_policy=%s\n' "$backup_source_policy"
		printf 'state_dir=%s\n' "$state_dir"
		printf 'phase=%s\n' "$phase"
		printf 'exit_status=%s\n' "$exit_status"
		printf 'mutation_started=%s\n' "$mutation_started"
		printf 'release_activated=%s\n' "$release_activated"
		printf 'unit_state=%s\n' "$unit_state_file"
		printf 'application_backup_archive=%s\n' "$application_backup_archive"
		printf 'application_backup_receipt=%s\n' "$application_backup_receipt"
		printf 'application_backup_offsite_archive=%s\n' \
			"$application_backup_offsite_archive"
		printf 'application_backup_offsite_receipt=%s\n' \
			"$application_backup_offsite_receipt"
		printf 'load_backup_archive=%s\n' "$load_backup_archive"
		printf 'load_backup_receipt=%s\n' "$load_backup_receipt"
		printf 'load_backup_offsite_archive=%s\n' "$load_backup_offsite_archive"
		printf 'load_backup_offsite_receipt=%s\n' \
			"$load_backup_offsite_receipt"
		printf 'recorded_at=%s\n' "$(date --iso-8601=seconds)"
	} >"$temporary_sentinel"
	chmod 600 "$temporary_sentinel"
	cutover_sync_tree "$state_dir"
	if [[ -f "$unit_state_file" ]]; then
		cutover_sync_path_and_parent "$unit_state_file"
	fi
	cutover_publish_file_durable "$temporary_sentinel" "$cutover_sentinel"
}

stop_cutover_units() {
	if ((${#timer_units[@]})); then
		systemctl --user stop "${timer_units[@]}"
	fi
	if ((${#service_units[@]})); then
		systemctl --user stop "${service_units[@]}"
	fi
}

quiesce_cutover_after_mutation() {
	local unit state enabled failed=0
	if ((${#timer_units[@]})); then
		systemctl --user stop "${timer_units[@]}" || failed=1
	fi
	if ((${#service_units[@]})); then
		systemctl --user stop "${service_units[@]}" || failed=1
	fi
	acquire_writer_lifetime_lock_exclusive || failed=1
	for unit in "${boot_units[@]}"; do
		systemctl --user disable "$unit" >/dev/null || failed=1
	done
	for unit in "${timer_units[@]}"; do
		state="$(systemctl --user show "$unit" --property=ActiveState --value)"
		[[ "$state" == inactive ]] || failed=1
	done
	for unit in "${service_units[@]}"; do
		state="$(systemctl --user show "$unit" --property=ActiveState --value)"
		[[ "$state" == inactive || "$state" == failed ]] || failed=1
	done
	for unit in "${boot_units[@]}"; do
		enabled="$(systemctl --user is-enabled "$unit" 2>/dev/null || true)"
		[[ "$enabled" == disabled ]] || failed=1
	done
	return "$failed"
}

disable_cutover_boot_units() {
	local unit
	for unit in "${boot_units[@]}"; do
		systemctl --user disable "$unit" >/dev/null
	done
}

restore_enablement_for_units() {
	local unit failed=0
	for unit in "$@"; do
		case "${prior_enabled_state[$unit]}" in
			enabled)
				systemctl --user enable "$unit" >/dev/null || failed=1
				;;
			enabled-runtime)
				systemctl --user enable --runtime "$unit" >/dev/null || failed=1
				;;
			disabled)
				systemctl --user disable "$unit" >/dev/null || failed=1
				;;
			*)
				printf 'Unsupported recorded unit enablement for %s: %s\n' \
					"$unit" "${prior_enabled_state[$unit]}" >&2
				failed=1
				;;
		esac
	done
	return "$failed"
}

restore_unit_if_previously_running() {
	local unit="$1"
	if [[ "${prior_running[$unit]:-0}" == 1 ]]; then
		systemctl --user start "$unit"
	else
		systemctl --user stop "$unit"
	fi
}

verify_service_states_restored() {
	local allow_timer_catchup="${1:-false}"
	local unit timer expected state result_state timer_expected
	local completion_capable true_daemon failed=0
	for unit in "${service_units[@]}"; do
		expected="${prior_active_state[$unit]}"
		state="$(systemctl --user show "$unit" --property=ActiveState --value)"
		timer="${unit%.service}.timer"
		timer_expected="${prior_active_state[$timer]:-inactive}"
		result_state="$(systemctl --user show "$unit" --property=Result --value)"
		completion_capable=false
		is_completion_capable_service_unit "$unit" &&
			completion_capable=true
		true_daemon=false
		[[ "$unit" == veud-staging-app.service ]] &&
			true_daemon=true
		if cutover_service_state_matches \
			"$expected" \
			"$state" \
			"$result_state" \
			"$completion_capable" \
			"$allow_timer_catchup" \
			"$timer_expected" \
			"$true_daemon"; then
			continue
		fi
		printf 'Staging service runtime state was not restored: %s (%s, expected %s)\n' \
			"$unit" "$state" "$expected" >&2
		failed=1
	done
	return "$failed"
}

verify_timer_states_restored() {
	local unit expected state failed=0
	for unit in "${timer_units[@]}"; do
		expected="${prior_active_state[$unit]}"
		state="$(systemctl --user show "$unit" --property=ActiveState --value)"
		if [[ "$state" != "$expected" ]]; then
			printf 'Staging timer runtime state was not restored: %s (%s, expected %s)\n' \
				"$unit" "$state" "$expected" >&2
			failed=1
		fi
	done
	return "$failed"
}

verify_enabled_states_unchanged() {
	local unit current_enabled failed=0
	for unit in "${all_units[@]}"; do
		current_enabled="$(systemctl --user is-enabled "$unit" 2>/dev/null || true)"
		if [[ "$current_enabled" != "${prior_enabled_state[$unit]}" ]]; then
			printf 'Unit enablement changed during cutover: %s\n' "$unit" >&2
			failed=1
		fi
	done
	return "$failed"
}

restore_prior_unit_states() {
	local unit failed=0
	restore_enablement_for_units veud-staging-app.service || failed=1
	for unit in "${service_units[@]}"; do
		restore_unit_if_previously_running "$unit" || failed=1
	done
	verify_service_states_restored false || failed=1
	restore_enablement_for_units "${timer_units[@]}" || failed=1
	for unit in "${regular_timer_units[@]}"; do
		restore_unit_if_previously_running "$unit" || failed=1
	done
	# Backup timers are intentionally restored last so no scheduled backup races
	# the application and catalog workers while they are being resumed.
	for unit in "${backup_timer_units[@]}"; do
		restore_unit_if_previously_running "$unit" || failed=1
	done
	verify_timer_states_restored || failed=1
	verify_service_states_restored true || failed=1
	verify_enabled_states_unchanged || failed=1
	return "$failed"
}

persist_recorded_unit_states() {
	local unit temporary_state="$unit_state_file.tmp-$$"
	{
		printf '# release=%s\n' "$commit"
		printf '# original_release=%s\n' "$original_release"
		printf '# bootstrap=%s\n' "$bootstrap"
		for unit in "${all_units[@]}"; do
			printf '%s\t%s\t%s\t%s\n' \
				"$unit" \
				"${prior_active_state[$unit]}" \
				"${prior_enabled_state[$unit]}" \
				"${prior_running[$unit]}"
		done
	} >"$temporary_state"
	chmod 600 "$temporary_state"
	cutover_publish_file_durable "$temporary_state" "$unit_state_file"
}

configure_bootstrap_target_states() {
	local unit
	[[ "$bootstrap" == true ]] || return 0

	for unit in "${service_units[@]}"; do
		prior_active_state["$unit"]=inactive
		prior_running["$unit"]=0
	done
	prior_active_state[veud-staging-app.service]=active
	prior_running[veud-staging-app.service]=1
	prior_enabled_state[veud-staging-app.service]=enabled

	for unit in "${timer_units[@]}"; do
		prior_active_state["$unit"]=inactive
		prior_running["$unit"]=0
		prior_enabled_state["$unit"]=disabled
	done

	for unit in "${backup_timer_units[@]}"; do
		prior_active_state["$unit"]=active
		prior_running["$unit"]=1
		prior_enabled_state["$unit"]=enabled
	done

	if [[ -n "${MAL_CLIENT_ID:-}" &&
		-n "${MAL_CATALOG_POLICY_APPROVAL_REF:-}" ]]; then
		for unit in \
			veud-staging-mal-hydration.timer \
			veud-staging-mal-inventory.timer \
			veud-staging-mal-trending.timer; do
			prior_active_state["$unit"]=active
			prior_running["$unit"]=1
			prior_enabled_state["$unit"]=enabled
		done
	fi
	if [[ -n "${MAL_CATALOG_POLICY_APPROVAL_REF:-}" ]]; then
		prior_active_state[veud-staging-jikan-anime-cast.timer]=active
		prior_running[veud-staging-jikan-anime-cast.timer]=1
		prior_enabled_state[veud-staging-jikan-anime-cast.timer]=enabled
	fi
	if [[ -n "${TMDB_API_KEY:-}" ]]; then
		for unit in \
			veud-staging-tmdb-hydration.timer \
			veud-staging-tmdb-inventory.timer; do
			prior_active_state["$unit"]=active
			prior_running["$unit"]=1
			prior_enabled_state["$unit"]=enabled
		done
	fi
	if [[ -n "${RESEND_API_KEY:-}" ]]; then
		prior_active_state[veud-staging-notification-digests.timer]=active
		prior_running[veud-staging-notification-digests.timer]=1
		prior_enabled_state[veud-staging-notification-digests.timer]=enabled
	fi

	persist_recorded_unit_states
}

recover_staging_cutover_failure() {
	local exit_status="$1"
	local definitions_restored=true
	if ((exit_status != 0)) && [[ "$deployment_succeeded" != true ]]; then
		if [[ "$mutation_started" == true ]]; then
			# A migrated or partially repaired database may not be compatible with
			# the old release. Keep every writer stopped and retain the original
			# unit-state record so rerunning this cutover can resume safely.
			phase='blocking-after-database-mutation'
			if ! write_cutover_sentinel "$exit_status"; then
				write_staging_emergency_block ||
					die 'Unable to publish either staging blocking authority'
			fi
			if quiesce_cutover_after_mutation; then
				phase='failed-after-database-mutation'
				write_cutover_sentinel "$exit_status"
				printf '%s\n' \
					'Staging remains in maintenance after database mutation.' \
					'Application, workers, notifications, and backup triggers were verified stopped and disabled.' \
					"Diagnostic sentinel: $cutover_sentinel" >&2
			else
				phase='quiescence-verification-failed'
				write_cutover_sentinel "$exit_status"
				printf '%s\n' \
					'Staging remains in blocking maintenance, but complete writer quiescence could not be verified.' \
					"Inspect systemd and $cutover_sentinel before recovery." >&2
			fi
			release_provider_locks
			elif [[ "$states_recorded" == true ]]; then
				phase='restore-before-mutation'
				write_cutover_sentinel "$exit_status"
			restore_original_unit_definitions || definitions_restored=false
			release_provider_locks
				release_writer_lifetime_lock
				if [[ "$definitions_restored" == true ]] &&
					restore_prior_unit_states; then
					# The sentinel is the sole durable incomplete-cutover authority.
					# Remove it first only after definitions and runtime state are
					# verified; a leftover unit-state file is safe to discard on the
					# next invocation.
					if cutover_remove_file_durable "$cutover_sentinel"; then
						cleanup_staging_release_artifacts "$commit" ||
							printf '%s\n' \
								'Staging restoration succeeded; deferred cleanup remains journaled.' \
								>&2
					else
						printf '%s\n' \
							'Staging restoration succeeded, but its cutover authority remains.' \
							>&2
					fi
			else
				phase='restoration-verification-failed'
				write_cutover_sentinel "$exit_status"
				printf 'Unable to fully restore pre-cutover unit state; inspect %s\n' \
					"$cutover_sentinel" >&2
			fi
		fi
	fi
}

staging_handle_injected_failure() {
	local exit_status="$1"
	set +e
	recover_staging_cutover_failure "$exit_status"
	transition_failure_handled=true
	set -e
	return 0
}

cleanup() {
	local exit_status=$?
	trap - EXIT
	set +e
	rm -rf "$temporary" "$current_next"
	if [[ "$transition_failure_handled" != true ]]; then
		recover_staging_cutover_failure "$exit_status"
	fi
	release_provider_locks
	exit "$exit_status"
}
trap cleanup EXIT

cutover_acquire_deployment_lock \
	"$STAGING_ROOT/run/provenance-cutover-deploy.lock" \
	'Another staging catalog deployment is already running'
cleanup_completed_staging_release
if [[ -e "$cutover_sentinel" || -L "$cutover_sentinel" ]]; then
	[[ -f "$cutover_sentinel" && ! -L "$cutover_sentinel" ]] ||
		die 'Staging cutover authority is not a regular non-symlink file'
	[[ "$(read_catalog_cutover_marker_value "$cutover_sentinel" format)" == 2 &&
		"$(read_catalog_cutover_marker_value "$cutover_sentinel" environment)" == staging &&
		"$(read_catalog_cutover_marker_value "$cutover_sentinel" release)" == "$commit" ]] ||
		die 'Existing staging cutover state belongs to another release or format'
	[[ -f "$unit_state_file" && ! -L "$unit_state_file" ]] ||
		die 'Existing staging cutover state has no unit-state record'
	[[ "$(read_catalog_cutover_marker_value "$unit_state_file" '# release')" == "$commit" ]] ||
		die 'Existing staging unit-state record belongs to another release'
elif [[ -e "$unit_state_file" || -L "$unit_state_file" ]]; then
	[[ -f "$unit_state_file" && ! -L "$unit_state_file" ]] ||
		die 'Staging unit-state journal is not a regular non-symlink file'
	discard_orphaned_staging_unit_state
fi
if [[ -e "$emergency_block_state" || -L "$emergency_block_state" ]]; then
	[[ -f "$emergency_block_state" && ! -L "$emergency_block_state" ]] ||
		die 'Staging emergency block authority is not a regular non-symlink file'
	[[ "$(read_catalog_cutover_marker_value "$emergency_block_state" format)" == 1 &&
		"$(read_catalog_cutover_marker_value "$emergency_block_state" environment)" == staging &&
		"$(read_catalog_cutover_marker_value "$emergency_block_state" release)" == "$commit" ]] ||
		die 'Existing staging emergency block belongs to another release or format'
fi
mkdir -p "$STAGING_ROOT/app/releases"

rm -rf "$temporary"
mkdir -p "$temporary"
git -C "$REPO_ROOT" archive "$commit" | tar -x -C "$temporary"

export PATH="$(dirname "$NODE_BIN"):$PG_BIN:/usr/bin:/bin"
cd "$temporary"
"$NPM_BIN" ci --include=dev
"$NPM_BIN" run prisma:generate:postgres
"$NPM_BIN" run build
grep -q 'catalogProvenanceVersion' \
	"$temporary/node_modules/.prisma/client/schema.prisma" ||
	die 'Generated PostgreSQL client does not contain catalog provenance fields'
grep -Eq 'provider[[:space:]]*=[[:space:]]*"postgresql"' \
	"$temporary/node_modules/.prisma/client/schema.prisma" ||
	die 'Generated staging Prisma client is not configured for PostgreSQL'
grep -q -- '--require-clean' \
	"$temporary/scripts/quarantine-media-catalog-provenance.ts" ||
	die 'Candidate release does not contain the provenance completion guard'
printf '%s\n' "$commit" >"$temporary/RELEASE"

if [[ -d "$release" ]]; then
	rm -rf "$temporary"
else
	cutover_publish_tree_durable "$temporary" "$release"
fi
grep -q 'catalogProvenanceVersion' \
	"$release/node_modules/.prisma/client/schema.prisma" ||
	die 'Immutable release does not contain a provenance-aware Prisma client'
grep -Eq 'provider[[:space:]]*=[[:space:]]*"postgresql"' \
	"$release/node_modules/.prisma/client/schema.prisma" ||
	die 'Immutable staging release does not contain a PostgreSQL Prisma client'
grep -q -- '--require-clean' \
	"$release/scripts/quarantine-media-catalog-provenance.ts" ||
	die 'Immutable release does not contain the provenance completion guard'
[[ -f "$release/scripts/assert-pristine-postgres.mjs" ]] ||
	die 'Immutable release is missing the pristine PostgreSQL completion guard'
[[ -f "$release/ops/catalog-cutover-common.sh" ]] ||
	die 'Immutable release is missing the shared catalog cutover policy'
[[ "$(cat "$release/RELEASE" 2>/dev/null || true)" == "$commit" ]] ||
	die 'Immutable staging release marker does not match the requested revision'
for required_unit in "${all_units[@]}"; do
	[[ -f "$release/ops/local-staging/systemd/$required_unit" ]] ||
		die "Immutable release is missing a staging cutover unit: $required_unit"
done
for required_launcher in \
	"$release"/ops/local-staging/run-*.sh; do
	[[ -x "$required_launcher" ]] ||
		die "Immutable staging launcher is not executable: $required_launcher"
done

record_unit_states() {
	local unit boot_unit load_state active_state enabled_state was_running
	local temporary_state="$unit_state_file.tmp-$$"
	if [[ "$bootstrap" == true ]]; then
		[[ "$original_release" == none ]] ||
			die 'Cannot record bootstrap state with an original release'
	else
		[[ "$original_release" =~ ^[0-9a-f]{40}$ ]] ||
			die 'Cannot record unit state without the original staging release'
	fi
	{
		printf '# release=%s\n' "$commit"
		printf '# original_release=%s\n' "$original_release"
		printf '# bootstrap=%s\n' "$bootstrap"
		for unit in "${all_units[@]}"; do
			load_state="$(
				systemctl --user show "$unit" --property=LoadState --value
			)"
			[[ "$load_state" == loaded ]] ||
				die "Required staging unit is not loaded: $unit"
			active_state="$(
				systemctl --user show "$unit" --property=ActiveState --value
			)"
			enabled_state="$(
				systemctl --user is-enabled "$unit" 2>/dev/null || true
			)"
			for boot_unit in "${boot_units[@]}"; do
				if [[ "$unit" == "$boot_unit" ]]; then
					case "$enabled_state" in
						enabled | enabled-runtime | disabled) ;;
						*)
							die "Required staging boot unit has unsupported enablement: $unit ($enabled_state)"
							;;
					esac
				fi
			done
			case "$active_state" in
				active) was_running=1 ;;
				inactive) was_running=0 ;;
				*)
					die "Required staging unit is not stable: $unit ($active_state)"
					;;
			esac
			if [[ "$bootstrap" == true ]]; then
				[[ "$active_state" == inactive ]] ||
					die "Fresh staging bootstrap requires inactive cutover units: $unit"
				for boot_unit in "${boot_units[@]}"; do
					if [[ "$unit" == "$boot_unit" ]]; then
						[[ "$enabled_state" == disabled ]] ||
							die "Fresh staging bootstrap requires disabled boot units: $unit"
					fi
				done
			fi
			prior_active_state["$unit"]="$active_state"
			prior_enabled_state["$unit"]="$enabled_state"
			prior_running["$unit"]="$was_running"
			printf '%s\t%s\t%s\t%s\n' \
				"$unit" "$active_state" "$enabled_state" "$was_running"
		done
	} >"$temporary_state"
	chmod 600 "$temporary_state"
	cutover_publish_file_durable "$temporary_state" "$unit_state_file"
	states_recorded=true
}

load_recorded_unit_states() {
	local unit active_state enabled_state was_running recorded_release recorded_original
	local recorded_bootstrap
	local -A seen_units=()
	[[ -f "$unit_state_file" ]] ||
		die "Incomplete cutover has no unit-state record: $unit_state_file"
	[[ -d "$state_dir" ]] ||
		die "Incomplete cutover has no durable state directory: $state_dir"
	verify_captured_unit_definitions ||
		die 'Incomplete cutover has invalid captured unit definitions'
	recorded_release="$(
		read_catalog_cutover_marker_value "$unit_state_file" '# release'
	)"
	recorded_original="$(
		read_catalog_cutover_marker_value "$unit_state_file" '# original_release'
	)"
	recorded_bootstrap="$(
		read_catalog_cutover_marker_value "$unit_state_file" '# bootstrap'
	)"
	[[ "$recorded_release" == "$commit" ]] ||
		die 'Staging unit-state record belongs to a different requested release'
	[[ "$recorded_bootstrap" == true || "$recorded_bootstrap" == false ]] ||
		die 'Staging unit-state record has an invalid bootstrap boundary'
	if [[ "$recorded_bootstrap" == true ]]; then
		[[ "$recorded_original" == none ]] ||
			die 'Staging bootstrap state has an invalid original release'
	else
		[[ "$recorded_original" =~ ^[0-9a-f]{40}$ ]] ||
			die 'Staging unit-state record has an invalid original release'
	fi
	if [[ -n "$original_release" && "$original_release" != "$recorded_original" ]]; then
		die 'Staging sentinel and unit-state record disagree on the original release'
	fi
	if [[ -n "$original_release" && "$bootstrap" != "$recorded_bootstrap" ]]; then
		die 'Staging sentinel and unit-state record disagree on bootstrap state'
	fi
	bootstrap="$recorded_bootstrap"
	original_release="$recorded_original"
	while IFS=$'\t' read -r unit active_state enabled_state was_running; do
		[[ -n "$unit" && "$unit" != \#* ]] || continue
		is_cutover_unit "$unit" ||
			die "Staging unit-state record names an unknown unit: $unit"
		[[ -z "${seen_units[$unit]+set}" ]] ||
			die "Staging unit-state record repeats unit: $unit"
		seen_units["$unit"]=1
		[[ "$active_state" == active || "$active_state" == inactive ]] ||
			die "Staging unit-state record has an invalid active state: $unit"
		[[ "$enabled_state" =~ ^[a-z-]+$ ]] ||
			die "Staging unit-state record has an invalid enabled state: $unit"
		[[ "$was_running" == 0 || "$was_running" == 1 ]] ||
			die "Staging unit-state record has an invalid running state: $unit"
		if [[ "$active_state" == active ]]; then
			[[ "$was_running" == 1 ]] ||
				die "Staging unit-state record is inconsistent for $unit"
		else
			[[ "$was_running" == 0 ]] ||
				die "Staging unit-state record is inconsistent for $unit"
		fi
		prior_active_state["$unit"]="$active_state"
		prior_enabled_state["$unit"]="$enabled_state"
		prior_running["$unit"]="$was_running"
	done <"$unit_state_file"
	for unit in "${all_units[@]}"; do
		[[ -v "prior_running[$unit]" ]] ||
			die "Unit-state record is incomplete for $unit"
	done
	states_recorded=true
}

load_cutover_sentinel_state() {
	local recorded_format recorded_environment recorded_release recorded_original
	local recorded_bootstrap recorded_state_dir recorded_phase
	local recorded_mutation recorded_activation recorded_backup_source_policy
	local active_release=''
	recorded_format="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" format
	)"
	recorded_environment="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" environment
	)"
	recorded_release="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" release
	)"
	recorded_original="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" original_release
	)"
	recorded_bootstrap="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" bootstrap
	)"
	recorded_backup_source_policy="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" backup_source_policy
	)"
	recorded_state_dir="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" state_dir
	)"
	recorded_phase="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" phase
	)"
	recorded_mutation="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" mutation_started
	)"
	recorded_activation="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" release_activated
	)"
	[[ "$recorded_format" == 2 && "$recorded_environment" == staging ]] ||
		die 'Unsupported staging cutover sentinel format or environment'
	[[ "$recorded_release" == "$commit" ]] ||
		die 'Incomplete staging cutover belongs to a different requested release'
	[[ "$recorded_state_dir" == "$state_dir" && -d "$recorded_state_dir" ]] ||
		die 'Staging cutover sentinel has an invalid durable state directory'
	[[ "$recorded_bootstrap" == true || "$recorded_bootstrap" == false ]] ||
		die 'Staging cutover sentinel has an invalid bootstrap boundary'
	if [[ "$recorded_bootstrap" == true ]]; then
		[[ "$recorded_original" == none ]] ||
			die 'Staging bootstrap sentinel has an invalid original release'
		[[ "$recorded_backup_source_policy" == pristine-empty-v1 ]] ||
			die 'Staging bootstrap sentinel has an invalid backup source policy'
	else
		[[ "$recorded_original" =~ ^[0-9a-f]{40}$ ]] ||
			die 'Staging cutover sentinel has an invalid original release'
		[[ "$recorded_backup_source_policy" == migrated-veud-v1 ]] ||
			die 'Staging cutover sentinel has an invalid backup source policy'
	fi
	[[ "$recorded_mutation" == true || "$recorded_mutation" == false ]] ||
		die 'Staging cutover sentinel has an invalid mutation boundary'
	[[ "$recorded_activation" == true || "$recorded_activation" == false ]] ||
		die 'Staging cutover sentinel has an invalid activation boundary'
	if [[ -L "$current" ]]; then
		active_release="$(active_staging_release_id)"
	fi
	cutover_release_boundary_matches \
		"$recorded_mutation" \
		"$recorded_activation" \
		"$recorded_phase" \
		"$recorded_bootstrap" \
		"$active_release" \
		"$recorded_original" \
		"$recorded_release" \
		healthcheck-new-release ||
		die 'Staging sentinel crosses its recorded release boundary'
	bootstrap="$recorded_bootstrap"
	backup_source_policy="$recorded_backup_source_policy"
	original_release="$recorded_original"
	mutation_started="$recorded_mutation"
	release_activated="$recorded_activation"
	application_backup_archive="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" application_backup_archive
	)"
	application_backup_receipt="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" application_backup_receipt
	)"
	application_backup_offsite_archive="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" application_backup_offsite_archive
	)"
	application_backup_offsite_receipt="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" application_backup_offsite_receipt
	)"
	load_backup_archive="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" load_backup_archive
	)"
	load_backup_receipt="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" load_backup_receipt
	)"
	load_backup_offsite_archive="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" load_backup_offsite_archive
	)"
	load_backup_offsite_receipt="$(
		read_catalog_cutover_marker_value "$cutover_sentinel" load_backup_offsite_receipt
	)"
}

if [[ -f "$cutover_sentinel" ]]; then
	load_cutover_sentinel_state
	load_recorded_unit_states
else
	# Unit state is written before the first sentinel so an interrupted
	# pre-maintenance capture can be retried. Without the sentinel no live
	# cutover mutation or supervisor transition is authoritative.
	rm -f "$unit_state_file"
	rm -rf "$state_dir"
	mkdir -p "$state_dir"
	if [[ -L "$current" ]]; then
		original_release="$(active_staging_release_id)"
		bootstrap=false
	elif [[ -e "$current" ]]; then
		die 'The staging current path exists but is not an immutable release symlink'
	else
		original_release=none
		bootstrap=true
	fi
	if [[ "$bootstrap" == true ]]; then
		backup_source_policy=pristine-empty-v1
	else
		backup_source_policy=migrated-veud-v1
	fi
	capture_unit_definitions
	verify_captured_unit_definitions ||
		die 'Unable to durably capture the original staging unit definitions'
	record_unit_states
fi

if [[ "$mutation_started" == true ]]; then
	verify_cutover_backup_evidence all ||
		die 'Recorded pre-mutation staging backup evidence is missing or invalid'
fi

release_activated=false
phase='stop-writers'
write_cutover_sentinel 0
stop_cutover_units
disable_cutover_boot_units
acquire_writer_lifetime_lock_exclusive ||
	die 'Unable to acquire the staging writer lifetime lock'
install_immutable_cutover_unit_definitions
"$PG_BIN/pg_isready" --host=127.0.0.1 --port=5433 >/dev/null ||
	die 'Staging PostgreSQL became unavailable during cutover'
if [[ "$mutation_started" == false ]]; then
	if [[ "$bootstrap" == true ]]; then
		[[ ! -e "$current" ]] ||
			die 'Fresh staging bootstrap unexpectedly gained an active release'
	else
		[[ "$(active_staging_release_id)" == "$original_release" ]] ||
			die 'Pre-mutation staging cutover is not on its recorded original release'
	fi
elif [[ -L "$current" ]]; then
	active_release="$(active_staging_release_id)"
	[[ "$active_release" == "$original_release" ||
		"$active_release" == "$commit" ]] ||
		die 'Staging cutover retry is outside its recorded release boundary'
elif [[ "$bootstrap" != true ]]; then
	die 'Staging cutover retry lost its active release'
fi

exec 8>"$STAGING_ROOT/run/mal-provider.lock"
exec 9>"$STAGING_ROOT/run/tmdb-provider.lock"
exec 10>"$STAGING_ROOT/run/jikan-provider.lock"
locks_held=true
lock_wait_seconds="${VEUD_STAGING_DEPLOY_LOCK_WAIT_SECONDS:-120}"
[[ "$lock_wait_seconds" =~ ^[1-9][0-9]*$ ]] ||
	die 'VEUD_STAGING_DEPLOY_LOCK_WAIT_SECONDS must be a positive integer'
flock --exclusive --wait "$lock_wait_seconds" 8 ||
	die 'Timed out draining the staging MAL catalog worker'
flock --exclusive --wait "$lock_wait_seconds" 9 ||
	die 'Timed out draining the staging TMDB catalog worker'
flock --exclusive --wait "$lock_wait_seconds" 10 ||
	die 'Timed out draining the staging Jikan catalog worker'
}

staging_backup_or_verify() {
local reconcile_status
if [[ "$mutation_started" == false ]]; then
	phase='backup-application-database'
	write_cutover_sentinel 0
	if reconcile_cutover_backup_evidence application; then
		:
	else
		reconcile_status=$?
		[[ "$reconcile_status" == 2 ]] ||
			die 'Existing staging application backup pins are incomplete or invalid'
		create_and_pin_cutover_backup \
			"$BACKUP_DIR" \
			"$OFFSITE_DIR" \
			application \
			env \
			DATABASE_URL="$application_database_url" \
			BACKUP_SOURCE_POLICY="$backup_source_policy" \
			BACKUP_DIR="$BACKUP_DIR" \
			BACKUP_OFFSITE_DIR="$OFFSITE_DIR" \
			"$NODE_BIN" "$release/scripts/backup-postgres.mjs"
	fi
	write_cutover_sentinel 0

	phase='backup-load-database'
	write_cutover_sentinel 0
	if reconcile_cutover_backup_evidence load; then
		:
	else
		reconcile_status=$?
		[[ "$reconcile_status" == 2 ]] ||
			die 'Existing staging load backup pins are incomplete or invalid'
		create_and_pin_cutover_backup \
			"$STAGING_ROOT/backups/catalog" \
			"$OFFSITE_DIR/catalog" \
			load \
			env \
			DATABASE_URL="$STAGING_LOAD_DATABASE_URL" \
			BACKUP_SOURCE_POLICY="$backup_source_policy" \
			BACKUP_DIR="$STAGING_ROOT/backups/catalog" \
			BACKUP_OFFSITE_DIR="$OFFSITE_DIR/catalog" \
			BACKUP_KEEP="${VEUD_STAGING_CATALOG_BACKUP_KEEP:-14}" \
			BACKUP_OFFSITE_KEEP="${VEUD_STAGING_CATALOG_OFFSITE_KEEP:-30}" \
			"$NODE_BIN" "$release/scripts/backup-postgres.mjs"
	fi
	write_cutover_sentinel 0

	if [[ "$backup_source_policy" == pristine-empty-v1 ]]; then
		phase='recheck-pristine-application-database'
		write_cutover_sentinel 0
		DATABASE_URL="$DATABASE_URL" \
			"$NODE_BIN" "$release/scripts/assert-pristine-postgres.mjs"
		phase='recheck-pristine-load-database'
		write_cutover_sentinel 0
		DATABASE_URL="$STAGING_LOAD_DATABASE_URL" \
			"$NODE_BIN" "$release/scripts/assert-pristine-postgres.mjs"
	fi
else
	verify_cutover_backup_evidence all ||
		die 'Recorded pre-mutation staging backup evidence is missing or invalid'
fi
}

drain_staging_database_sessions_at_mutation_boundary() {
	local database
	(
		load_admin_environment
		for database in veud_staging veud_staging_load; do
			env \
				-u PGHOST \
				-u PGHOSTADDR \
				-u PGPORT \
				-u PGDATABASE \
				-u PGUSER \
				-u PGADMINPASSWORD \
				-u PGPASSFILE \
				-u PGSERVICE \
				-u PGSERVICEFILE \
				-u PGOPTIONS \
				-u PGTARGETSESSIONATTRS \
				-u PGSSLMODE \
				-u PGREQUIREAUTH \
				-u PGCHANNELBINDING \
				-u PGGSSENCMODE \
				PGPASSWORD="$PGADMINPASSWORD" \
				"$PG_BIN/psql" \
				--no-psqlrc \
				--host=127.0.0.1 \
				--port=5433 \
				--username="$PGADMINUSER" \
				--dbname=postgres \
				--set=ON_ERROR_STOP=1 \
				--set="veud_database=$database" \
				--quiet \
				--command="
					SELECT pg_catalog.pg_terminate_backend(activity.pid)
					FROM pg_catalog.pg_stat_activity AS activity
					WHERE activity.datname = :'veud_database'
					  AND activity.pid <> pg_catalog.pg_backend_pid();
				" \
				--command="
					SELECT 1 / CASE WHEN (
						EXISTS (
							SELECT 1
							FROM pg_catalog.pg_database AS database_object
							WHERE database_object.datname = :'veud_database'
						) AND
						NOT EXISTS (
							SELECT 1
							FROM pg_catalog.pg_stat_activity AS activity
							WHERE activity.datname = :'veud_database'
							  AND activity.pid <> pg_catalog.pg_backend_pid()
						) AND
						NOT EXISTS (
							SELECT 1
							FROM pg_catalog.pg_prepared_xacts AS prepared
							WHERE prepared.database = :'veud_database'
						)
					) THEN 1 ELSE 0 END;
				" \
				>/dev/null
		done
	)
}

staging_mutate() {
cd "$release"
phase='drain-database-sessions-at-mutation-boundary'
write_cutover_sentinel 0
drain_staging_database_sessions_at_mutation_boundary
if [[ "$mutation_started" == false &&
	"$backup_source_policy" == pristine-empty-v1 ]]; then
	phase='attest-pristine-databases-at-mutation-boundary'
	write_cutover_sentinel 0
	DATABASE_URL="$DATABASE_URL" \
		"$NODE_BIN" "$release/scripts/assert-pristine-postgres.mjs"
	DATABASE_URL="$STAGING_LOAD_DATABASE_URL" \
		"$NODE_BIN" "$release/scripts/assert-pristine-postgres.mjs"
fi
phase='migrate-application-database'
write_staging_emergency_block
mutation_started=true
write_cutover_sentinel 0
DATABASE_URL="$DATABASE_URL" "$NPM_BIN" run db:migrate:postgres
phase='migrate-load-database'
write_cutover_sentinel 0
DATABASE_URL="$STAGING_LOAD_DATABASE_URL" "$NPM_BIN" run db:migrate:postgres

phase='verify-migrated-databases'
write_cutover_sentinel 0
DATABASE_URL="$DATABASE_URL" "$NPM_BIN" run db:verify:postgres
DATABASE_URL="$STAGING_LOAD_DATABASE_URL" "$NPM_BIN" run db:verify:postgres
DATABASE_URL="$DATABASE_URL" "$NPM_BIN" run db:smoke:postgres

run_provenance_repair() {
	local label="$1"
	local database_url="$2"
	printf 'Catalog provenance dry run: %s\n' "$label"
	DATABASE_URL="$database_url" "$NPM_BIN" run catalog:repair-provenance -- \
		--batch-size 100
	printf 'Catalog provenance repair: %s\n' "$label"
	DATABASE_URL="$database_url" "$NPM_BIN" run catalog:repair-provenance -- \
		--batch-size 100 \
		--commit \
		--confirm QUARANTINE_UNTRUSTED_MEDIA_CATALOG
}

phase='repair-application-database'
write_cutover_sentinel 0
run_provenance_repair 'application database' "$DATABASE_URL"
phase='repair-load-database'
write_cutover_sentinel 0
run_provenance_repair 'load database' "$STAGING_LOAD_DATABASE_URL"

phase='synchronize-linked-application-metadata'
write_cutover_sentinel 0
DATABASE_URL="$DATABASE_URL" "$NPM_BIN" \
	run catalog:sync-watchlist-metadata -- \
	--commit \
	--batch-size 100

phase='assert-provenance-boundaries'
write_cutover_sentinel 0
DATABASE_URL="$DATABASE_URL" "$NPM_BIN" run catalog:repair-provenance -- \
	--batch-size 100 \
	--require-clean
DATABASE_URL="$STAGING_LOAD_DATABASE_URL" "$NPM_BIN" \
	run catalog:repair-provenance -- \
	--batch-size 100 \
	--require-clean
}

staging_activate_and_health() {
phase='activate-release'
write_cutover_sentinel 0
ln -s "$release" "$current_next"
cutover_publish_symlink_durable "$current_next" "$current"

phase='healthcheck-new-release'
write_cutover_sentinel 0
cutover_remove_file_durable "$emergency_block_state"
release_writer_lifetime_lock
systemctl --user restart veud-staging-app.service
health_ready=false
health_headers="$state_dir/staging-health.headers"
for _ in {1..60}; do
	app_state="$(
		systemctl --user show veud-staging-app.service \
			--property=ActiveState \
			--value
	)"
	if [[ "$app_state" == active ]] &&
		cutover_isolated_health_request \
			"$health_headers" \
			"http://127.0.0.1:4022/resources/healthcheck" &&
		cutover_health_headers_match "$health_headers" "$commit" staging; then
		health_ready=true
		break
	fi
	sleep 1
done
[[ "$health_ready" == true ]] ||
	die 'The compatible staging release did not pass its exact local healthcheck'
release_activated=true
configure_bootstrap_target_states
}

staging_restore() {
release_provider_locks
if [[ "$bootstrap" == true ]]; then
	phase='post-bootstrap-application-backup'
	write_cutover_sentinel 0
	"$release/ops/local-staging/run-backup.sh"
	phase='post-bootstrap-load-backup'
	write_cutover_sentinel 0
	"$release/ops/local-staging/run-load-backup.sh"
fi
phase='restore-prior-unit-states'
write_cutover_sentinel 0
restore_prior_unit_states
cutover_sync_tree "$unit_dir"
}

staging_complete() {
# All compatible services and timers have been verified at this point. Publish
# completion by removing the sole incomplete-cutover authority first. If the
# process stops during the remaining housekeeping, a later deploy safely
# discards the non-authoritative unit-state file.
write_staging_completion_cleanup_state
cutover_remove_file_durable "$cutover_sentinel"
deployment_succeeded=true
cutover_remove_file_durable "$emergency_block_state"
if cleanup_staging_release_artifacts "$commit"; then
	cutover_remove_file_durable "$completion_cleanup_state"
else
	printf '%s\n' \
		'Staging activation succeeded; deferred cleanup remains journaled.' >&2
fi
trap - EXIT
printf '\nDeployed commit %s to local staging with a verified provenance cutover.\n' \
	"$commit"
}

cutover_run_transition_driver staging
