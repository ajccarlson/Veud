#!/usr/bin/env bash
set -Eeuo pipefail

owner_pid="${1:-}"
wait_seconds="${2:-}"
flock_binary="${3:-}"
[[ "$owner_pid" =~ ^[1-9][0-9]*$ ]] || {
	printf '%s\n' \
		'PostgreSQL restore lock holder requires its owner PID' >&2
	exit 2
}
[[ "$wait_seconds" =~ ^[1-9][0-9]*$ ]] || {
	printf '%s\n' \
		'PostgreSQL restore lock holder requires bounded wait seconds' >&2
	exit 2
}
[[ "$flock_binary" == /* ]] || {
	printf '%s\n' \
		'PostgreSQL restore lock holder requires an absolute flock binary' >&2
	exit 2
}

if "$flock_binary" --exclusive --wait "$wait_seconds" 3; then
	:
else
	status=$?
	printf 'PostgreSQL restore lock acquisition failed with status %s\n' \
		"$status" >&2
	exit "$status"
fi

trap 'exit 0' INT TERM
printf 'VEUD_POSTGRES_RESTORE_LOCK_READY:%s\n' "$$"
while kill -0 "$owner_pid" 2>/dev/null; do
	sleep 0.1
done
