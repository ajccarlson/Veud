#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
verify_node_22
require_command git
require_command flock
require_command systemctl
require_command tar

cd "$REPO_ROOT"
release="$(git rev-parse HEAD)"
[[ -n "$release" ]] || die 'Unable to resolve the release revision'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
	die 'Refusing to package a release with tracked working-tree changes'

releases_root="$PRODUCTION_ROOT/app/releases"
destination="$releases_root/$release"
partial="$releases_root/.${release}.partial-$$"
current="$PRODUCTION_ROOT/app/current"
current_next="$PRODUCTION_ROOT/app/.current-${release}-$$"
active_worker_services=()
active_worker_timers=()
workers_paused=false
locks_held=false
database_mutation_started=false
release_activated=false

catalog_worker_services=(
	veud-production-mal-hydration.service
	veud-production-mal-inventory.service
	veud-production-mal-trending.service
	veud-production-tmdb-hydration.service
	veud-production-tmdb-inventory.service
)
catalog_worker_timers=(
	veud-production-mal-hydration.timer
	veud-production-mal-inventory.timer
	veud-production-mal-trending.timer
	veud-production-tmdb-hydration.timer
	veud-production-tmdb-inventory.timer
)

release_provider_locks() {
	if [[ "$locks_held" == true ]]; then
		exec 8>&-
		exec 9>&-
		locks_held=false
	fi
}

resume_catalog_workers() {
	release_provider_locks
	if ((${#active_worker_timers[@]})); then
		systemctl --user start "${active_worker_timers[@]}"
	fi
	if ((${#active_worker_services[@]})); then
		systemctl --user start --no-block "${active_worker_services[@]}"
	fi
	workers_paused=false
}

cleanup() {
	rm -rf "$partial" "$current_next"
	if [[ "$workers_paused" == true ]]; then
		release_provider_locks
		if [[ "$database_mutation_started" == true && "$release_activated" != true ]]; then
			printf '%s\n' \
				'Catalog workers remain paused: database mutation began, but the compatible release was not activated. Rerun this deploy before resuming them.' \
				>&2
		else
			if ((${#active_worker_timers[@]})); then
				systemctl --user start "${active_worker_timers[@]}" || true
			fi
			if ((${#active_worker_services[@]})); then
				systemctl --user start --no-block "${active_worker_services[@]}" ||
					true
			fi
		fi
	fi
}
trap cleanup EXIT

grep -Eq 'provider[[:space:]]*=[[:space:]]*"postgresql"' \
	"$REPO_ROOT/node_modules/.prisma/client/schema.prisma" ||
	die 'Refusing to package dependencies without a PostgreSQL Prisma client'
grep -q 'nextReleaseAt' "$REPO_ROOT/node_modules/.prisma/client/schema.prisma" ||
	die 'Refusing to deploy before generating the next-release-aware Prisma client'

mkdir -p "$releases_root"
if [[ ! -d "$destination" ]]; then
	mkdir -p "$partial"
	git archive "$release" | tar -x -C "$partial"
	cp -a "$REPO_ROOT/node_modules" "$partial/node_modules"
	printf '%s\n' "$release" >"$partial/RELEASE"
	mv "$partial" "$destination"
fi

[[ "$(cat "$destination/RELEASE")" == "$release" ]] ||
	die 'Immutable release marker does not match the requested revision'
[[ -x "$destination/node_modules/.bin/tsx" ]] ||
	die 'Immutable release dependencies are incomplete'

# Resolve and verify the exact local production identity before pausing workers
# or running any database-mutating command.
load_production_environment
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
DATABASE_URL="$DATABASE_URL" "$NODE_BIN" --input-type=module -e '
	import { assertProductionDatabaseUrl } from "./scripts/production-environment-utils.mjs"
	try {
		assertProductionDatabaseUrl(process.env.DATABASE_URL)
	} catch {
		console.error("Refusing to deploy to an unexpected production database")
		process.exit(1)
	}
'

# Pause timers first, then stop any in-flight systemd workers. Provider locks
# also cover manually launched workers and close the timer race between stop
# and migration. The bounded wait aborts instead of activating a mixed release.
for unit in "${catalog_worker_timers[@]}"; do
	if systemctl --user is-active --quiet "$unit"; then
		active_worker_timers+=("$unit")
	fi
done
for unit in "${catalog_worker_services[@]}"; do
	if systemctl --user is-active --quiet "$unit"; then
		active_worker_services+=("$unit")
	fi
done
workers_paused=true
if ((${#active_worker_timers[@]})); then
	systemctl --user stop "${active_worker_timers[@]}"
fi
if ((${#active_worker_services[@]})); then
	systemctl --user stop "${active_worker_services[@]}"
fi

mkdir -p "$PRODUCTION_ROOT/run"
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

database_mutation_started=true
(
	cd "$destination"
	DATABASE_URL="$DATABASE_URL" "$destination/node_modules/.bin/prisma" \
		migrate deploy \
		--schema="$destination/prisma/postgresql/schema.prisma"
	DATABASE_URL="$DATABASE_URL" "$destination/node_modules/.bin/tsx" \
		"$destination/scripts/backfill-next-release-at.ts" \
		--commit
)

ln -s "$destination" "$current_next"
mv -Tf "$current_next" "$current"
release_activated=true

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

resume_catalog_workers
trap - EXIT
printf 'Activated immutable production catalog release %s\n' "$release"
