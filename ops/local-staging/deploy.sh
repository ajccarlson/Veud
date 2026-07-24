#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
guard_backup_storage
load_application_environment
load_staging_environment
verify_node_22
require_command git
require_command tar

commit="${1:-HEAD}"
commit="$(git -C "$REPO_ROOT" rev-parse --verify "$commit^{commit}")"
release="$STAGING_ROOT/app/releases/$commit"
temporary="$release.partial-$$"
rm -rf "$temporary"
mkdir -p "$temporary"
trap 'rm -rf "$temporary"' EXIT
git -C "$REPO_ROOT" archive "$commit" | tar -x -C "$temporary"

export PATH="$(dirname "$NODE_BIN"):$PG_BIN:/usr/bin:/bin"
cd "$temporary"
"$NPM_BIN" ci --include=dev
"$NPM_BIN" run prisma:generate:postgres
"$NPM_BIN" run build
"$NPM_BIN" run db:migrate:postgres
"$NPM_BIN" run db:verify:postgres
"$NPM_BIN" run db:smoke:postgres
DATABASE_URL="$STAGING_LOAD_DATABASE_URL" "$NPM_BIN" run db:migrate:postgres
DATABASE_URL="$STAGING_LOAD_DATABASE_URL" "$NPM_BIN" run db:verify:postgres

if [[ -d "$release" ]]; then
	rm -rf "$temporary"
else
	mv "$temporary" "$release"
fi
trap - EXIT
ln -sfn "$release" "$STAGING_ROOT/app/current.next"
mv -Tf "$STAGING_ROOT/app/current.next" "$STAGING_ROOT/app/current"

unit_dir="$HOME/.config/systemd/user"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-notification-digests.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-notification-digests.timer" "$unit_dir/"
systemctl --user daemon-reload
systemctl --user enable --now veud-staging-app.service
systemctl --user restart veud-staging-app.service
systemctl --user enable --now veud-staging-backup.timer
if [[ -n "${MAL_CLIENT_ID:-}" && -n "${MAL_CATALOG_POLICY_APPROVAL_REF:-}" ]]; then
	systemctl --user enable --now veud-staging-mal-hydration.timer
	systemctl --user enable --now veud-staging-mal-inventory.timer
	systemctl --user enable --now veud-staging-mal-trending.timer
fi
if [[ -n "${TMDB_API_KEY:-}" ]]; then
	systemctl --user enable --now veud-staging-tmdb-hydration.timer
	systemctl --user enable --now veud-staging-tmdb-inventory.timer
fi
systemctl --user enable --now veud-staging-catalog-backup.timer
if [[ -n "${RESEND_API_KEY:-}" ]]; then
	systemctl --user enable --now veud-staging-notification-digests.timer
else
	systemctl --user disable --now veud-staging-notification-digests.timer || true
fi

for _ in {1..60}; do
	curl --fail --silent --show-error "http://127.0.0.1:4022/resources/healthcheck" >/dev/null 2>&1 && break
	sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:4022/resources/healthcheck"
printf '\nDeployed commit %s to local staging.\n' "$commit"
