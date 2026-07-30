#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
run_guarded_worker scripts/send-notification-digests.ts --commit --limit 100
