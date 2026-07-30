#!/usr/bin/env bash
set -Eeuo pipefail

# Pure and filesystem-scoped catalog-cutover primitives shared by production
# and staging. Environment-specific supervisor sequencing stays in each deploy
# script.

read_catalog_cutover_marker_value() {
	local marker="$1" key="$2"
	local -a values=()
	[[ -f "$marker" && ! -L "$marker" ]] ||
		die "Catalog cutover authority is not a regular non-symlink file: $marker"
	mapfile -t values < <(sed -n "s/^${key}=//p" "$marker")
	((${#values[@]} == 1)) ||
		die "Catalog cutover marker has an invalid $key field: $marker"
	printf '%s' "${values[0]}"
}

cutover_sync_path_and_parent() {
	local target="$1"
	sync -f "$target"
	sync -f "$(dirname "$target")"
}

cutover_publish_file_durable() {
	local temporary="$1" target="$2"
	sync -f "$temporary"
	mv -f "$temporary" "$target"
	cutover_sync_path_and_parent "$target"
}

cutover_remove_file_durable() {
	local target="$1"
	if [[ -e "$target" || -L "$target" ]]; then
		rm -f "$target"
		sync -f "$(dirname "$target")"
	fi
}

cutover_remove_tree_durable() {
	local target="$1"
	if [[ -e "$target" || -L "$target" ]]; then
		rm -rf -- "$target"
		sync -f "$(dirname "$target")"
	fi
}

cutover_sync_tree() {
	local root="$1"
	[[ -d "$root" ]] || return 1
	# GNU sync -f issues syncfs(2) for the containing filesystem. One bounded
	# call therefore flushes the entire tree and its directory metadata; walking
	# node_modules would only repeat the same filesystem-wide flush thousands of
	# times.
	sync -f "$root"
}

cutover_publish_tree_durable() {
	local temporary="$1" target="$2"
	[[ -d "$temporary" && ! -e "$target" && ! -L "$target" ]] || return 1
	cutover_sync_tree "$temporary"
	mv "$temporary" "$target"
	cutover_sync_path_and_parent "$target"
}

cutover_publish_symlink_durable() {
	local temporary="$1" target="$2"
	[[ -L "$temporary" ]] || return 1
	mv -Tf "$temporary" "$target"
	sync -f "$(dirname "$target")"
}

# Publish a brand-new private file so a crash can never leave a partial,
# world-readable, or half-validated secret in place. The temporary file is
# created with O_EXCL semantics by mktemp inside the destination directory
# (same filesystem, so the link is atomic), tightened to 0600, validated by the
# caller's predicate, flushed, then hard linked into place. `ln` fails when the
# target already exists, which is the no-clobber half of the guarantee.
cutover_publish_new_private_file() {
	local temporary="$1" target="$2"
	[[ -f "$temporary" && ! -L "$temporary" ]] ||
		die "Publication source is not a regular non-symlink file: $temporary"
	[[ ! -e "$target" && ! -L "$target" ]] ||
		die "Refusing to clobber an existing publication target: $target"
	# `ln` cannot cross filesystems; require the temporary to be a sibling so
	# the no-clobber publish can never degrade into a copy.
	[[ "$(stat -c %d -- "$temporary")" == "$(stat -c %d -- "$(dirname "$target")")" ]] ||
		die "Publication temporary is not on the target filesystem: $target"
	[[ -s "$temporary" ]] ||
		die "Refusing to publish an empty file: $target"
	chmod 600 "$temporary"
	sync -f "$temporary"
	ln "$temporary" "$target" ||
		die "Could not atomically publish: $target"
	rm -f "$temporary"
	sync -f "$(dirname "$target")"
	[[ -f "$target" && ! -L "$target" ]] ||
		die "Published file is not a regular non-symlink file: $target"
}

cutover_new_private_temporary() {
	local directory="$1"
	local temporary
	temporary="$(umask 077 && mktemp "$directory/.veud-publish.XXXXXXXX")" ||
		die "Could not create a private temporary file in: $directory"
	printf '%s' "$temporary"
}

cutover_acquire_deployment_lock() {
	local lock_file="$1" message="$2"
	mkdir -p "$(dirname "$lock_file")"
	exec 7>"$lock_file"
	flock -n 7 || die "$message"
}

cutover_test_fault_requested() {
	local phase="$1"
	[[ -z "${VEUD_CUTOVER_TEST_FAULT_PHASE:-}" ]] && return 1
	[[ "${VEUD_CUTOVER_TEST_MODE:-}" == 1 ]] ||
		die 'Cutover fault injection requires VEUD_CUTOVER_TEST_MODE=1'
	[[ "$VEUD_CUTOVER_TEST_FAULT_PHASE" == "$phase" ]]
}

cutover_run_transition_driver() {
	local prefix="$1" step status
	local -a steps=(
		stop_and_drain
		backup_or_verify
		mutate
		activate_and_health
		restore
	)
	for step in "${steps[@]}"; do
		"${prefix}_${step}"
		if cutover_test_fault_requested "after-$step"; then
			status=97
			"${prefix}_handle_injected_failure" "$status"
			return "$status"
		fi
	done
	"${prefix}_complete"
}

cutover_active_release_id() {
	local current="$1" releases_root="$2" target release_id marker
	[[ -L "$current" ]] || return 1
	target="$(readlink -f "$current")"
	release_id="${target##*/}"
	marker="$(cat "$target/RELEASE" 2>/dev/null || true)"
	[[ "$release_id" =~ ^[0-9a-f]{40}$ &&
		"$marker" == "$release_id" &&
		"$target" == "$releases_root/$release_id" ]] ||
		return 1
	printf '%s' "$release_id"
}

cutover_release_boundary_matches() {
	local mutation="$1" activated="$2" phase="$3" bootstrap="$4"
	local active="$5" original="$6" requested="$7" health_phase="$8"
	[[ "$mutation" == true || "$mutation" == false ]] || return 1
	[[ "$activated" == true || "$activated" == false ]] || return 1
	[[ "$bootstrap" == true || "$bootstrap" == false ]] || return 1
	[[ "$requested" =~ ^[0-9a-f]{40}$ ]] || return 1
	if [[ "$bootstrap" == true ]]; then
		[[ "$original" == none ]] || return 1
	else
		[[ "$original" =~ ^[0-9a-f]{40}$ ]] || return 1
	fi

	if [[ "$mutation" == false ]]; then
		[[ "$activated" == false ]] || return 1
		if [[ "$bootstrap" == true ]]; then
			[[ -z "$active" ]]
		else
			[[ "$active" == "$original" ]]
		fi
	elif [[ "$activated" == true || "$phase" == "$health_phase" ]]; then
		[[ "$active" == "$requested" ]]
	else
		[[ -z "$active" || "$active" == "$original" || "$active" == "$requested" ]]
	fi
}

cutover_service_state_matches() {
	local expected="$1" actual="$2" result="$3" completion_capable="$4"
	local allow_timer_catchup="$5" timer_expected="$6" true_daemon="$7"
	[[ "$expected" == active || "$expected" == inactive ]] || return 1
	[[ "$completion_capable" == true || "$completion_capable" == false ]] ||
		return 1
	[[ "$allow_timer_catchup" == true || "$allow_timer_catchup" == false ]] ||
		return 1
	[[ "$true_daemon" == true || "$true_daemon" == false ]] || return 1
	[[ "$timer_expected" == active || "$timer_expected" == inactive ]] ||
		return 1

	[[ "$actual" == "$expected" ]] && return 0
	if [[ "$expected" == active &&
		"$actual" == inactive &&
		"$completion_capable" == true &&
		"$true_daemon" == false &&
		"$result" == success ]]; then
		return 0
	fi
	if [[ "$expected" == inactive &&
		("$actual" == active || "$actual" == activating) &&
		"$allow_timer_catchup" == true &&
		"$timer_expected" == active &&
		"$true_daemon" == false ]]; then
		return 0
	fi
	return 1
}

cutover_verify_backup_pair() {
	local node_bin="$1" archive="$2" receipt="$3"
	local expected_source="${4:-}" expected_restore="${5:-}"
	local expected_policy="${6:-}"
	local recorded_source recorded_restore recorded_policy
	read -r \
		recorded_source \
		recorded_restore \
		recorded_policy < <(
		ARCHIVE_PATH="$archive" RECEIPT_PATH="$receipt" \
			"$node_bin" --input-type=module -e '
			import { createHash } from "node:crypto"
			import fs from "node:fs"

			function readRegular(filename, maximumBytes, label) {
				const pathStat = fs.lstatSync(filename, { bigint: true })
				if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
					throw new Error(`${label} must be a regular non-symlink file`)
				}
				if (pathStat.size < 1n || pathStat.size > BigInt(maximumBytes)) {
					throw new Error(`${label} has an unsafe size`)
				}
				const descriptor = fs.openSync(
					filename,
					fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
				)
				try {
					const before = fs.fstatSync(descriptor, { bigint: true })
					if (
						before.dev !== pathStat.dev ||
						before.ino !== pathStat.ino ||
						before.size !== pathStat.size
					) throw new Error(`${label} changed while it was opened`)
					const hash = createHash("sha256")
					const chunks = []
					const buffer = Buffer.allocUnsafe(Math.min(maximumBytes, 1024 * 1024))
					let bytes = 0
					for (;;) {
						const count = fs.readSync(
							descriptor,
							buffer,
							0,
							buffer.length,
							null,
						)
						if (!count) break
						bytes += count
						hash.update(buffer.subarray(0, count))
						if (maximumBytes <= 1024 * 1024) {
							chunks.push(Buffer.from(buffer.subarray(0, count)))
						}
					}
					const after = fs.fstatSync(descriptor, { bigint: true })
					if (
						after.dev !== before.dev ||
						after.ino !== before.ino ||
						after.size !== before.size ||
						after.mtimeNs !== before.mtimeNs ||
						after.ctimeNs !== before.ctimeNs
					) throw new Error(`${label} changed while it was read`)
					return {
						bytes,
						sha256: hash.digest("hex"),
						content: chunks.length ? Buffer.concat(chunks).toString("utf8") : "",
					}
				} finally {
					fs.closeSync(descriptor)
				}
			}

			const archive = readRegular(
				process.env.ARCHIVE_PATH,
				Number.MAX_SAFE_INTEGER,
				"Cutover archive",
			)
			const receiptFile = readRegular(
				process.env.RECEIPT_PATH,
				64 * 1024,
				"Cutover receipt",
			)
			const receipt = JSON.parse(receiptFile.content)
			function exactObject(value, fields) {
				if (
					!value ||
					typeof value !== "object" ||
					Array.isArray(value) ||
					Object.getPrototypeOf(value) !== Object.prototype
				) return false
				const actual = Object.keys(value).sort()
				const expected = [...fields].sort()
				return (
					actual.length === expected.length &&
					actual.every((field, index) => field === expected[index])
				)
			}
			function credentialFreeTarget(value) {
				if (
					typeof value !== "string" ||
					value.length < 5 ||
					value.length > 2048 ||
					/[\u0000-\u001f\u007f\s@]/.test(value)
				) return false
				const match = /^(.+):([0-9]{1,5})\/([^/]+)$/.exec(value)
				const port = match ? Number(match[2]) : Number.NaN
				return Boolean(
					match &&
					match[1] &&
					match[3] &&
					port >= 1 &&
					port <= 65535,
				)
			}
			const rootFields = [
				"version",
				"verifiedAt",
				"sourceTarget",
				"restoreTarget",
				"checks",
				"archive",
				"summary",
			]
			const summaryFields = [
				"users",
				"watchlists",
				"entries",
				"media",
				"migrations",
			]
			const verifiedAt = new Date(receipt?.verifiedAt)
			const validTimestamp =
				typeof receipt?.verifiedAt === "string" &&
				receipt.verifiedAt.length <= 64 &&
				Number.isFinite(verifiedAt.valueOf()) &&
				verifiedAt.toISOString() === receipt.verifiedAt
			const validSummary =
				exactObject(receipt?.summary, summaryFields) &&
				summaryFields.every(
					field =>
						Number.isSafeInteger(receipt.summary[field]) &&
						receipt.summary[field] >= 0,
				)
			if (
				!exactObject(receipt, rootFields) ||
				receipt.version !== 2 ||
				!validTimestamp ||
				!credentialFreeTarget(receipt.sourceTarget) ||
				!credentialFreeTarget(receipt.restoreTarget) ||
				receipt.sourceTarget === receipt.restoreTarget ||
				!exactObject(receipt.checks, [
					"expectedIdentity",
					"sourcePolicy",
				]) ||
				typeof receipt.checks.expectedIdentity !== "boolean" ||
				!["migrated-veud-v1", "pristine-empty-v1"].includes(
					receipt.checks.sourcePolicy,
				) ||
				!exactObject(receipt.archive, ["name", "bytes", "sha256"]) ||
				!/^[0-9a-f]{64}$/.test(receipt?.archive?.sha256) ||
				!Number.isSafeInteger(receipt?.archive?.bytes) ||
				receipt.archive.bytes < 1 ||
				typeof receipt?.archive?.name !== "string" ||
				!/^[^/]+\.dump$/.test(receipt.archive.name) ||
				receipt.archive.name.includes("/") ||
				!validSummary
			) process.exit(1)
			if (
				archive.sha256 !== receipt.archive.sha256 ||
				archive.bytes !== receipt.archive.bytes
			) process.exit(1)
			if (
				receipt.checks.sourcePolicy === "pristine-empty-v1" &&
				(receipt.checks.expectedIdentity ||
					summaryFields.some(field => receipt.summary[field] !== 0))
			) process.exit(1)
			process.stdout.write(
				`${receipt.sourceTarget} ${receipt.restoreTarget} ` +
				`${receipt.checks.sourcePolicy}\n`,
			)
		'
	) || return 1
	[[ -z "$expected_source" || "$recorded_source" == "$expected_source" ]] ||
		return 1
	[[ -z "$expected_restore" || "$recorded_restore" == "$expected_restore" ]] ||
		return 1
	[[ -z "$expected_policy" || "$recorded_policy" == "$expected_policy" ]] ||
		return 1
}

cutover_pin_backup_file() {
	local source="$1" destination="$2" temporary_pin parent
	local source_identity pin_identity destination_identity
	[[ -f "$source" && ! -L "$source" ]] || return 1
	temporary_pin="${destination}.tmp-$$"
	parent="$(dirname "$destination")"
	mkdir -p "$parent"
	[[ -d "$parent" && ! -L "$parent" ]] || return 1
	if [[ -e "$destination" || -L "$destination" ]]; then
		[[ -f "$destination" && ! -L "$destination" ]] || return 1
		source_identity="$(stat -c '%d:%i:%s' -- "$source")" || return 1
		destination_identity="$(
			stat -c '%d:%i:%s' -- "$destination"
		)" || return 1
		[[ "$source_identity" == "$destination_identity" ]] || return 1
		return 0
	fi
	rm -f "$temporary_pin"
	ln -P -- "$source" "$temporary_pin" || return 1
	if [[ ! -f "$temporary_pin" || -L "$temporary_pin" ]]; then
		rm -f -- "$temporary_pin"
		return 1
	fi
	source_identity="$(stat -c '%d:%i:%s' -- "$source")" || {
		rm -f -- "$temporary_pin"
		return 1
	}
	pin_identity="$(stat -c '%d:%i:%s' -- "$temporary_pin")" || {
		rm -f -- "$temporary_pin"
		return 1
	}
	if [[ "$source_identity" != "$pin_identity" ]]; then
		rm -f -- "$temporary_pin"
		return 1
	fi
	# A second hard link is an atomic no-clobber publication. Existing evidence
	# for this release is immutable; recovery must revalidate it, never replace it.
	ln -P -- "$temporary_pin" "$destination" || {
		rm -f -- "$temporary_pin"
		return 1
	}
	destination_identity="$(stat -c '%d:%i:%s' -- "$destination")" || {
		rm -f -- "$destination" "$temporary_pin"
		return 1
	}
	if [[ "$destination_identity" != "$pin_identity" ||
		! -f "$destination" ||
		-L "$destination" ]]; then
		rm -f -- "$destination" "$temporary_pin"
		return 1
	fi
	sync -f "$destination"
	sync -f "$parent"
	rm -f -- "$temporary_pin"
	sync -f "$parent"
}

cutover_reconcile_backup_pins() {
	local node_bin="$1" backup_dir="$2" offsite_dir="$3"
	local pin_root="$4" offsite_pin_root="$5" label="$6"
	local expected_source="$7" expected_restore="$8" expected_policy="$9"
	local pinned_archive="$pin_root/$label.dump"
	local pinned_receipt="${pinned_archive}.restore-verified.json"
	local pinned_offsite="$offsite_pin_root/$label.dump"
	local pinned_offsite_receipt="${pinned_offsite}.restore-verified.json"
	local -a pins=(
		"$pinned_archive"
		"$pinned_receipt"
		"$pinned_offsite"
		"$pinned_offsite_receipt"
	)
	local -a roots=(
		"$backup_dir"
		"$backup_dir"
		"$offsite_dir"
		"$offsite_dir"
	)
	local pin root match basename candidate='' present=0 index
	local -a matches=()

	for pin in "${pins[@]}"; do
		if [[ ! -e "$pin" && ! -L "$pin" ]]; then
			continue
		fi
		[[ -f "$pin" && ! -L "$pin" ]] || return 1
		((present += 1))
	done
	((present > 0)) || return 2
	if ((present == 4)); then
		cutover_verify_backup_pair \
			"$node_bin" \
			"$pinned_archive" \
			"$pinned_receipt" \
			"$expected_source" \
			"$expected_restore" \
			"$expected_policy" ||
			return 1
		cutover_verify_backup_pair \
			"$node_bin" \
			"$pinned_offsite" \
			"$pinned_offsite_receipt" \
			"$expected_source" \
			"$expected_restore" \
			"$expected_policy" ||
			return 1
		printf '%s\t%s\t%s\t%s\n' \
			"$pinned_archive" \
			"$pinned_receipt" \
			"$pinned_offsite" \
			"$pinned_offsite_receipt"
		return 0
	fi

	for index in "${!pins[@]}"; do
		pin="${pins[$index]}"
		root="${roots[$index]}"
		[[ -e "$pin" ]] || continue
		mapfile -t matches < <(
			find "$root" \
				-maxdepth 1 \
				-type f \
				-samefile "$pin" \
				-printf '%f\n'
		)
		((${#matches[@]} == 1)) || return 1
		match="${matches[0]}"
		if ((index == 1 || index == 3)); then
			[[ "$match" == *.dump.restore-verified.json ]] || return 1
			basename="${match%.restore-verified.json}"
		else
			[[ "$match" == *.dump ]] || return 1
			basename="$match"
		fi
		[[ "$basename" != */* ]] || return 1
		if [[ -z "$candidate" ]]; then
			candidate="$basename"
		else
			[[ "$candidate" == "$basename" ]] || return 1
		fi
	done

	[[ -n "$candidate" ]] || return 1
	local archive="$backup_dir/$candidate"
	local receipt="${archive}.restore-verified.json"
	local offsite_archive="$offsite_dir/$candidate"
	local offsite_receipt="${offsite_archive}.restore-verified.json"
	cutover_verify_backup_pair \
		"$node_bin" \
		"$archive" \
		"$receipt" \
		"$expected_source" \
		"$expected_restore" \
		"$expected_policy" ||
		return 1
	cutover_verify_backup_pair \
		"$node_bin" \
		"$offsite_archive" \
		"$offsite_receipt" \
		"$expected_source" \
		"$expected_restore" \
		"$expected_policy" ||
		return 1

	cutover_pin_backup_file "$archive" "$pinned_archive" || return 1
	cutover_pin_backup_file "$receipt" "$pinned_receipt" || return 1
	cutover_pin_backup_file "$offsite_archive" "$pinned_offsite" || return 1
	cutover_pin_backup_file \
		"$offsite_receipt" \
		"$pinned_offsite_receipt" ||
		return 1
	cutover_verify_backup_pair \
		"$node_bin" \
		"$pinned_archive" \
		"$pinned_receipt" \
		"$expected_source" \
		"$expected_restore" \
		"$expected_policy" ||
		return 1
	cutover_verify_backup_pair \
		"$node_bin" \
		"$pinned_offsite" \
		"$pinned_offsite_receipt" \
		"$expected_source" \
		"$expected_restore" \
		"$expected_policy" ||
		return 1
	printf '%s\t%s\t%s\t%s\n' \
		"$pinned_archive" \
		"$pinned_receipt" \
		"$pinned_offsite" \
		"$pinned_offsite_receipt"
}

cutover_create_and_pin_backup() {
	local node_bin="$1" state_dir="$2" backup_dir="$3" offsite_dir="$4"
	local pin_root="$5" offsite_pin_root="$6" label="$7"
	local expected_source="$8" expected_restore="$9"
	local expected_policy="${10}"
	shift 10
	[[ -n "$expected_source" &&
		-n "$expected_restore" &&
		"$expected_source" != "$expected_restore" &&
		("$expected_policy" == migrated-veud-v1 ||
			"$expected_policy" == pristine-empty-v1) ]] ||
		die 'Cutover backup source, restore identity, and policy must be explicit'
	local before="$state_dir/$label-before" after="$state_dir/$label-after"
	local -a created=()
	local archive receipt offsite_archive offsite_receipt
	local pinned_archive pinned_receipt pinned_offsite pinned_offsite_receipt
	mkdir -p "$backup_dir" "$offsite_dir"
	find "$backup_dir" -maxdepth 1 -type f -name 'postgres-*.dump' \
		-printf '%f\n' | sort >"$before"
	"$@" >&2
	find "$backup_dir" -maxdepth 1 -type f -name 'postgres-*.dump' \
		-printf '%f\n' | sort >"$after"
	mapfile -t created < <(comm -13 "$before" "$after")
	((${#created[@]} == 1)) ||
		die "Expected exactly one new restore-verified $label backup"
	archive="$backup_dir/${created[0]}"
	receipt="${archive}.restore-verified.json"
	offsite_archive="$offsite_dir/${created[0]}"
	offsite_receipt="${offsite_archive}.restore-verified.json"
	cutover_verify_backup_pair \
		"$node_bin" \
		"$archive" \
		"$receipt" \
		"$expected_source" \
		"$expected_restore" \
		"$expected_policy" ||
		die "New $label backup does not match its restore receipt"
	cutover_verify_backup_pair \
		"$node_bin" \
		"$offsite_archive" \
		"$offsite_receipt" \
		"$expected_source" \
		"$expected_restore" \
		"$expected_policy" ||
		die "New offsite $label backup does not match its restore receipt"

	pinned_archive="$pin_root/$label.dump"
	pinned_receipt="${pinned_archive}.restore-verified.json"
	pinned_offsite="$offsite_pin_root/$label.dump"
	pinned_offsite_receipt="${pinned_offsite}.restore-verified.json"
	cutover_pin_backup_file "$archive" "$pinned_archive"
	cutover_pin_backup_file "$receipt" "$pinned_receipt"
	cutover_pin_backup_file "$offsite_archive" "$pinned_offsite"
	cutover_pin_backup_file "$offsite_receipt" "$pinned_offsite_receipt"
	cutover_verify_backup_pair \
		"$node_bin" \
		"$pinned_archive" \
		"$pinned_receipt" \
		"$expected_source" \
		"$expected_restore" \
		"$expected_policy" ||
		die "Pinned $label backup does not match its restore receipt"
	cutover_verify_backup_pair \
		"$node_bin" \
		"$pinned_offsite" \
		"$pinned_offsite_receipt" \
		"$expected_source" \
		"$expected_restore" \
		"$expected_policy" ||
		die "Pinned offsite $label backup does not match its restore receipt"
	printf '%s\t%s\t%s\t%s\n' \
		"$pinned_archive" \
		"$pinned_receipt" \
		"$pinned_offsite" \
		"$pinned_offsite_receipt"
}

cutover_capture_unit_definitions() {
	local state_dir="$1" unit_dir="$2"
	shift 2
	local unit fragment dropins exec_start target metadata
	[[ -d "$unit_dir" && ! -L "$unit_dir" && ! -L "$state_dir" ]] ||
		die 'Catalog cutover unit or state directory is not a regular directory'
	mkdir -p \
		"$state_dir/unit-files" \
		"$state_dir/unit-files-absent" \
		"$state_dir/unit-effective"
	[[ -d "$state_dir" && ! -L "$state_dir" ]] ||
		die 'Catalog cutover state directory is invalid'
	for unit in "$@"; do
		target="$unit_dir/$unit"
		metadata="$state_dir/unit-effective/$unit"
		mkdir -p "$metadata"
		if [[ -e "$target" || -L "$target" ]]; then
			[[ -f "$target" && ! -L "$target" ]] ||
				die "Systemd unit is not a regular non-symlink file: $unit"
			cp -a "$target" "$state_dir/unit-files/$unit"
		else
			: >"$state_dir/unit-files-absent/$unit"
		fi
		fragment="$(
			systemctl --user show "$unit" --property=FragmentPath --value
		)"
		dropins="$(
			systemctl --user show "$unit" --property=DropInPaths --value
		)"
		exec_start="$(
			systemctl --user show "$unit" --property=ExecStart --value
		)"
		[[ -n "$fragment" &&
			"$fragment" != *$'\n'* &&
			"$exec_start" != *$'\n'* ]] ||
			die "Systemd effective definition is malformed: $unit"
		[[ -z "$dropins" ]] ||
			die "Systemd drop-ins are forbidden for catalog cutover unit: $unit"
		[[ -f "$fragment" && ! -L "$fragment" ]] ||
			die "Systemd fragment is not a regular non-symlink file: $unit"
		if [[ -f "$target" ]]; then
			[[ "$fragment" == "$target" ]] ||
				die "Systemd fragment does not match the managed unit file: $unit"
		fi
		printf '%s' "$fragment" >"$metadata/FragmentPath"
		printf '%s' "$exec_start" >"$metadata/ExecStart"
	done
}

cutover_verify_captured_unit_definitions() {
	local state_dir="$1"
	shift
	local unit metadata
	for unit in "$@"; do
		metadata="$state_dir/unit-effective/$unit"
		if [[ -f "$state_dir/unit-files/$unit" ]]; then
			[[ ! -e "$state_dir/unit-files-absent/$unit" ]] || return 1
		elif [[ -f "$state_dir/unit-files-absent/$unit" ]]; then
			[[ ! -e "$state_dir/unit-files/$unit" ]] || return 1
		else
			return 1
		fi
		[[ -f "$metadata/FragmentPath" &&
			! -L "$metadata/FragmentPath" &&
			-f "$metadata/ExecStart" &&
			! -L "$metadata/ExecStart" &&
			! -L "$state_dir/unit-files/$unit" &&
			! -L "$state_dir/unit-files-absent/$unit" ]] ||
			return 1
	done
}

cutover_verify_effective_immutable_units() {
	local unit_dir="$1" immutable_prefix="$2" mutable_prefix="$3"
	shift 3
	local unit fragment dropins exec_start
	for unit in "$@"; do
		fragment="$(
			systemctl --user show "$unit" --property=FragmentPath --value
		)" || return 1
		dropins="$(
			systemctl --user show "$unit" --property=DropInPaths --value
		)" || return 1
		exec_start="$(
			systemctl --user show "$unit" --property=ExecStart --value
		)" || return 1
		[[ "$fragment" == "$unit_dir/$unit" &&
			-z "$dropins" &&
			-f "$fragment" &&
			! -L "$fragment" ]] ||
			return 1
		if [[ "$unit" == *.service ]]; then
			[[ -n "$exec_start" &&
				"$exec_start" == *"$immutable_prefix/"* &&
				"$exec_start" != *"$mutable_prefix"* ]] ||
				return 1
		fi
	done
}

cutover_verify_restored_unit_definitions() {
	local state_dir="$1"
	shift
	local unit metadata expected_fragment expected_exec
	local fragment dropins exec_start
	for unit in "$@"; do
		metadata="$state_dir/unit-effective/$unit"
		[[ -f "$metadata/FragmentPath" &&
			! -L "$metadata/FragmentPath" &&
			-f "$metadata/ExecStart" &&
			! -L "$metadata/ExecStart" ]] ||
			return 1
		expected_fragment="$(cat "$metadata/FragmentPath")" || return 1
		expected_exec="$(cat "$metadata/ExecStart")" || return 1
		fragment="$(
			systemctl --user show "$unit" --property=FragmentPath --value
		)" || return 1
		dropins="$(
			systemctl --user show "$unit" --property=DropInPaths --value
		)" || return 1
		exec_start="$(
			systemctl --user show "$unit" --property=ExecStart --value
		)" || return 1
		[[ -z "$dropins" &&
			"$fragment" == "$expected_fragment" &&
			"$exec_start" == "$expected_exec" &&
			-f "$fragment" &&
			! -L "$fragment" ]] ||
			return 1
	done
}

cutover_install_immutable_units() {
	local state_dir="$1" unit_dir="$2" source_dir="$3"
	local mutable_prefix="$4" immutable_prefix="$5"
	shift 5
	local unit source rendered
	mkdir -p "$unit_dir" "$state_dir/rendered-units"
	[[ -d "$unit_dir" && ! -L "$unit_dir" &&
		-d "$state_dir/rendered-units" &&
		! -L "$state_dir/rendered-units" ]] ||
		die 'Catalog cutover unit or rendered-state directory is invalid'
	for unit in "$@"; do
		source="$source_dir/$unit"
		[[ -f "$source" && ! -L "$source" ]] ||
			die "Candidate release has an invalid unit: $unit"
		[[ ! -L "$unit_dir/$unit" ]] ||
			die "Managed systemd unit target is a symlink: $unit"
		rendered="$state_dir/rendered-units/$unit"
		[[ ! -L "$rendered" ]] ||
			die "Rendered systemd unit state is a symlink: $unit"
		sed "s|$mutable_prefix|$immutable_prefix|g" "$source" >"$rendered"
		if [[ "$unit" == *.service ]]; then
			grep -Fq "ExecStart=$immutable_prefix/" "$rendered" ||
				die "Service is not bound to the immutable release: $unit"
		fi
		! grep -Fq "$mutable_prefix" "$rendered" ||
			die "Unit retains a mutable checkout launcher: $unit"
		install -m 600 "$rendered" "$unit_dir/$unit"
		cutover_sync_path_and_parent "$unit_dir/$unit"
	done
	systemctl --user daemon-reload
	cutover_verify_effective_immutable_units \
		"$unit_dir" \
		"$immutable_prefix" \
		"$mutable_prefix" \
		"$@" ||
		die 'Installed systemd units do not match their effective immutable definitions'
}

cutover_restore_unit_definitions() {
	local state_dir="$1" unit_dir="$2"
	shift 2
	local unit failed=0
	[[ -d "$state_dir/unit-files" ]] || return 1
	for unit in "$@"; do
		if [[ -L "$unit_dir/$unit" ]]; then
			failed=1
			continue
		fi
		if [[ -f "$state_dir/unit-files/$unit" ]]; then
			if install -m 600 "$state_dir/unit-files/$unit" "$unit_dir/$unit"; then
				cutover_sync_path_and_parent "$unit_dir/$unit" || failed=1
			else
				failed=1
			fi
		elif [[ -f "$state_dir/unit-files-absent/$unit" ]]; then
			cutover_remove_file_durable "$unit_dir/$unit" || failed=1
		else
			failed=1
		fi
	done
	systemctl --user daemon-reload || failed=1
	cutover_verify_restored_unit_definitions "$state_dir" "$@" || failed=1
	return "$failed"
}

# Health checks must observe the claimed loopback service and nothing else.
# Ambient curl state can otherwise redirect or stall them: ~/.curlrc can set a
# proxy or --url, http_proxy/ALL_PROXY can divert the request, and a missing
# timeout can hang a deployment indefinitely. `--disable` must come first (it
# is only honoured as the first argument), proxies are refused for every host,
# the protocol is pinned to plain HTTP, redirects are never followed, and both
# the connect and total time are bounded.
CUTOVER_CURL_BIN="${CUTOVER_CURL_BIN:-/usr/bin/curl}"
CUTOVER_HEALTH_CONNECT_TIMEOUT_SECONDS="${CUTOVER_HEALTH_CONNECT_TIMEOUT_SECONDS:-2}"
CUTOVER_HEALTH_MAX_TIME_SECONDS="${CUTOVER_HEALTH_MAX_TIME_SECONDS:-10}"

cutover_isolated_health_request() {
	local headers="$1" url="$2"
	[[ -x "$CUTOVER_CURL_BIN" ]] || return 1
	# `127.0.0.1:4021@evil.example` parses as userinfo + a foreign host, so the
	# shape must be pinned exactly: loopback, numeric port, path, no userinfo.
	[[ "$url" =~ ^http://127\.0\.0\.1:[0-9]{1,5}/[^@[:space:]]*$ ]] || return 1
	env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
		-u ALL_PROXY -u all_proxy -u NO_PROXY -u no_proxy -u CURL_HOME \
		"$CUTOVER_CURL_BIN" \
		--disable \
		--noproxy '*' \
		--proto '=http' \
		--proto-redir '-all' \
		--max-redirs 0 \
		--connect-timeout "$CUTOVER_HEALTH_CONNECT_TIMEOUT_SECONDS" \
		--max-time "$CUTOVER_HEALTH_MAX_TIME_SECONDS" \
		--fail \
		--silent \
		--show-error \
		--dump-header "$headers" \
		--output /dev/null \
		"$url"
}

cutover_health_headers_match() {
	local headers="$1" release="$2" environment="$3"
	[[ "$release" =~ ^[0-9a-f]{40}$ ]] || return 1
	[[ "$environment" == production || "$environment" == staging ]] || return 1
	awk -v expected_release="$release" -v expected_environment="$environment" '
		{
			sub(/\r$/, "")
			separator = index($0, ":")
			if (separator == 0) next
			name = tolower(substr($0, 1, separator - 1))
			value = substr($0, separator + 1)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			if (name == "x-veud-release") {
				release_count += 1
				release_valid = release_valid || value == expected_release
				if (value != expected_release) release_conflict = 1
			}
			if (name == "x-veud-environment") {
				environment_count += 1
				environment_valid = environment_valid || value == expected_environment
				if (value != expected_environment) environment_conflict = 1
			}
		}
		END {
			valid = release_count == 1 && environment_count == 1 && release_valid && environment_valid && !release_conflict && !environment_conflict
			exit(valid ? 0 : 1)
		}
	' "$headers"
}
