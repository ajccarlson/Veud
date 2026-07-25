#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
verify_node_22
require_command git
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

grep -Eq 'provider[[:space:]]*=[[:space:]]*"postgresql"' \
	"$REPO_ROOT/node_modules/.prisma/client/schema.prisma" ||
	die 'Refusing to package dependencies without a PostgreSQL Prisma client'

mkdir -p "$releases_root"
if [[ ! -d "$destination" ]]; then
	trap 'rm -rf "$partial" "$current_next"' EXIT
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

ln -s "$destination" "$current_next"
mv -Tf "$current_next" "$current"
trap - EXIT

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

printf 'Activated immutable production catalog release %s\n' "$release"
