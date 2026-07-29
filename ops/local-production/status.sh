#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

guard_live_storage
guard_backup_storage
load_production_environment
verify_node_22

export PATH="$(dirname "$NODE_BIN"):$PG_BIN:/usr/bin:/bin"
cd "$REPO_ROOT"

DATABASE_URL="$DATABASE_URL" npm run --silent db:verify:postgres
DATABASE_URL="$DATABASE_URL" "$NODE_BIN" --input-type=module -e '
	const { parsePostgresConnection } =
		await import("./scripts/postgres-backup-utils.mjs")
	let connection
	try {
		connection = parsePostgresConnection(process.env.DATABASE_URL, "DATABASE_URL")
	} catch {
		console.error("Production DATABASE_URL is invalid")
		process.exit(1)
	}
	const env = {
		PGHOST: connection.host,
		PGPORT: connection.port,
		PGUSER: connection.user,
		PGPASSWORD: connection.password,
		PGDATABASE: connection.database,
	}
	const child = await import("node:child_process")
	const result = child.spawnSync(process.env.PSQL_BIN, [
		"--set", "ON_ERROR_STOP=1",
		"--tuples-only", "--no-align", "--field-separator=|",
		"--command", `
			SELECT current_database(), current_setting($$server_version$$),
				(SELECT COUNT(*) FROM "User"),
				(SELECT COUNT(*) FROM "Watchlist"),
				(SELECT COUNT(*) FROM "Entry"),
				(SELECT COUNT(*) FROM "Media"),
				(SELECT COUNT(*) FROM "_prisma_migrations"
				 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL);
		`,
	], { env: { ...process.env, ...env }, encoding: "utf8" })
	if (result.status !== 0) {
		process.stderr.write(result.stderr)
		process.exit(result.status ?? 1)
	}
	process.stdout.write(result.stdout)
'

systemctl --user --no-pager status \
	veud-production-mal-inventory.timer \
	veud-production-mal-hydration.timer \
	veud-production-mal-trending.timer \
	veud-production-tmdb-inventory.timer \
	veud-production-tmdb-hydration.timer || true

if [[ -L "$APP_ROOT" ]]; then
	printf '\nCatalog operations:\n'
	(
		cd "$APP_ROOT"
		"$NPM_BIN" run --silent catalog:status
	)
fi

printf 'Primary backup storage: '
df -h "$LIVE_MOUNT" | tail -1
printf 'Offsite backup storage: '
df -h "$BACKUP_MOUNT" | tail -1
