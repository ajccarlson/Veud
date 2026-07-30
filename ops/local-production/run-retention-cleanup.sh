#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

prepare_worker
run_guarded_worker scripts/cleanup-expired-data.ts --commit
