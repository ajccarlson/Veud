#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/common.sh"

archive="${1:-}"
confirmation="${2:-}"
[[ -n "$archive" && -f "$archive" ]] ||
	die 'Usage: prepare-target.sh CATALOG_DUMP PREPARE_VEUD_PRODUCTION'
[[ "$confirmation" == 'PREPARE_VEUD_PRODUCTION' ]] ||
	die 'Type PREPARE_VEUD_PRODUCTION as the second argument'
receipt="$archive.restore-verified.json"
[[ -f "$receipt" ]] ||
	die "The source archive is missing its restore-verified receipt: $receipt"

guard_live_storage
guard_backup_storage
load_production_environment
verify_node_22

export PATH="$(dirname "$NODE_BIN"):$PG_BIN:/usr/bin:/bin"
cd "$REPO_ROOT"

"$PG_RESTORE_BIN" --list "$archive" >/dev/null
ARCHIVE_PATH="$archive" RECEIPT_PATH="$receipt" "$NODE_BIN" --input-type=module -e '
	import { createHash } from "node:crypto"
	import fs from "node:fs"
	const archive = fs.readFileSync(process.env.ARCHIVE_PATH)
	const receipt = JSON.parse(fs.readFileSync(process.env.RECEIPT_PATH, "utf8"))
	const sha256 = createHash("sha256").update(archive).digest("hex")
	if (receipt?.version !== 1 || receipt?.archive?.sha256 !== sha256) {
		throw new Error("Source archive SHA-256 does not match its restore receipt")
	}
	if (receipt.archive.bytes !== archive.byteLength) {
		throw new Error("Source archive size does not match its restore receipt")
	}
'

DATABASE_URL="$DATABASE_URL" "$NODE_BIN" -e '
	const url = new URL(process.env.DATABASE_URL)
	if (url.hostname !== "127.0.0.1" || url.port !== "5433" || url.pathname !== "/veud_production") {
		throw new Error("Refusing to prepare an unexpected production target")
	}
'

export PGHOST=127.0.0.1
export PGPORT=5433
export PGUSER=veud_production_app
export PGDATABASE=veud_production
PGPASSWORD="${DATABASE_URL#*veud_production_app:}"
export PGPASSWORD="${PGPASSWORD%%@*}"
"$PSQL_BIN" \
	--set=ON_ERROR_STOP=1 \
	--command='DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER;'
"$PG_RESTORE_BIN" \
	--exit-on-error \
	--no-owner \
	--no-privileges \
	--dbname=veud_production \
	"$archive"

npm run db:migrate:postgres
npm run db:verify:postgres

restored_summary="$("$PSQL_BIN" \
	--set=ON_ERROR_STOP=1 \
	--tuples-only \
	--no-align \
	--command="
		SELECT
			(SELECT COUNT(*) FROM \"User\")::text || '|' ||
			(SELECT COUNT(*) FROM \"Watchlist\")::text || '|' ||
			(SELECT COUNT(*) FROM \"Entry\")::text || '|' ||
			(SELECT COUNT(*) FROM \"Media\")::text || '|' ||
			(SELECT COUNT(*) FROM \"_prisma_migrations\"
			 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' ||
			(SELECT COUNT(*) FROM pg_constraint
			 WHERE contype = 'f' AND NOT convalidated)::text || '|' ||
			(SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm')::text;
	")"
printf '%s\n' "$restored_summary"
RESTORED_SUMMARY="$restored_summary" RECEIPT_PATH="$receipt" \
	"$NODE_BIN" --input-type=module -e '
		import fs from "node:fs"
		const receipt = JSON.parse(fs.readFileSync(process.env.RECEIPT_PATH, "utf8"))
		const [users, watchlists, entries, media, migrations, invalidFks, trgm] =
			process.env.RESTORED_SUMMARY.trim().split("|").map(Number)
		const expected = receipt.summary
		if (
			users !== expected.users ||
			watchlists !== expected.watchlists ||
			entries !== expected.entries ||
			media !== expected.media ||
			migrations < expected.migrations ||
			invalidFks !== 0 ||
			trgm !== 1
		) {
			throw new Error("Prepared production counts do not match the verified source receipt")
		}
	'

unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
npm run db:backup:postgres
printf 'Prepared, migration-verified, backup-restored, and offsite-protected %s.\n' \
	"$(production_database_identity)"
