#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$#" -eq 2 ]] || {
	printf 'Usage: %s HYDRATION_UNIT WORKER_SCRIPT\n' "$0" >&2
	exit 2
}

hydration_unit="$1"
worker_script="$2"
script_dir="$(cd "$(dirname "$0")" && pwd)"

[[ "$hydration_unit" =~ ^veud-production-(mal|tmdb)-hydration\.service$ ]] || {
	printf 'Unsupported hydration unit: %s\n' "$hydration_unit" >&2
	exit 2
}
case "$worker_script" in
	"$script_dir"/run-mal-inventory.sh | \
		"$script_dir"/run-mal-trending.sh | \
		"$script_dir"/run-tmdb-inventory.sh) ;;
	*)
		printf 'Unsupported prioritized worker: %s\n' "$worker_script" >&2
		exit 2
		;;
esac
[[ -x "$worker_script" ]] || {
	printf 'Prioritized worker is not executable: %s\n' "$worker_script" >&2
	exit 2
}

resume_hydration=false
if systemctl --user is-active --quiet "$hydration_unit"; then
	resume_hydration=true
	systemctl --user stop "$hydration_unit"
fi

resume_worker() {
	if [[ "$resume_hydration" == true ]]; then
		systemctl --user start --no-block "$hydration_unit" || true
	fi
}
trap resume_worker EXIT

"$worker_script"
