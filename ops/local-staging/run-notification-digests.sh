#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
load_application_environment
verify_node_22

[[ -n "${RESEND_API_KEY:-}" ]] || die 'RESEND_API_KEY is not configured'
[[ -L "$STAGING_ROOT/app/current" ]] || die 'No staged application release is active'

export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
export VEUD_ORIGIN="${VEUD_ORIGIN:-https://staging.veud.net}"
cd "$STAGING_ROOT/app/current"
exec "$NPM_BIN" run notifications:digests -- --commit --limit 100
