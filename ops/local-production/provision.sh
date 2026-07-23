#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/common.sh"

guard_live_storage
guard_backup_storage
verify_node_22
require_command openssl

umask 077
mkdir -p \
	"$PRODUCTION_ROOT/config" \
	"$PRODUCTION_BACKUP_DIR" \
	"$PRODUCTION_OFFSITE_DIR"
chmod 700 \
	"$PRODUCTION_ROOT" \
	"$PRODUCTION_ROOT/config" \
	"$PRODUCTION_BACKUP_DIR" \
	"$PRODUCTION_OFFSITE_DIR"

if [[ ! -f "$PRODUCTION_CONFIG_FILE" ]]; then
	app_password="$(openssl rand -hex 32)"
	restore_password="$(openssl rand -hex 32)"
	{
		printf 'DATABASE_URL="postgresql://veud_production_app:%s@127.0.0.1:5433/veud_production?schema=public"\n' "$app_password"
		printf 'POSTGRES_BACKUP_VERIFY_URL="postgresql://veud_production_restore:%s@127.0.0.1:5433/veud_production_restore?schema=public"\n' "$restore_password"
		printf 'BACKUP_DIR="%s"\n' "$PRODUCTION_BACKUP_DIR"
		printf 'BACKUP_KEEP="48"\n'
		printf 'BACKUP_OFFSITE_DIR="%s"\n' "$PRODUCTION_OFFSITE_DIR"
		printf 'BACKUP_OFFSITE_KEEP="168"\n'
		printf 'BACKUP_OFFSITE_MOUNTPOINT="%s"\n' "$BACKUP_MOUNT"
		printf 'BACKUP_OFFSITE_MIN_FREE_BYTES="53687091200"\n'
		printf 'PG_DUMP_BIN="%s/pg_dump"\n' "$PG_BIN"
		printf 'PG_RESTORE_BIN="%s/pg_restore"\n' "$PG_BIN"
		printf 'PSQL_BIN="%s/psql"\n' "$PG_BIN"
	} >"$PRODUCTION_CONFIG_FILE"
	chmod 600 "$PRODUCTION_CONFIG_FILE"
fi

load_production_environment
load_admin_environment

"$PG_BIN/pg_isready" --host=127.0.0.1 --port=5433 >/dev/null ||
	die 'The local PostgreSQL service is not ready'

app_password="${DATABASE_URL#*veud_production_app:}"
app_password="${app_password%%@*}"
restore_password="${POSTGRES_BACKUP_VERIFY_URL#*veud_production_restore:}"
restore_password="${restore_password%%@*}"

export PGPASSWORD="$PGADMINPASSWORD"
{
	printf '%s\n' \
		"SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'veud_production_app', '$app_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'veud_production_app')\\gexec" \
		"ALTER ROLE veud_production_app PASSWORD '$app_password';" \
		"SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'veud_production_restore', '$restore_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'veud_production_restore')\\gexec" \
		"ALTER ROLE veud_production_restore PASSWORD '$restore_password';"
} | "$PG_BIN/psql" \
	--host=127.0.0.1 \
	--port=5433 \
	--username="$PGADMINUSER" \
	--dbname=postgres \
	--set=ON_ERROR_STOP=1

for database_and_owner in \
	'veud_production veud_production_app' \
	'veud_production_restore veud_production_restore'; do
	read -r database owner <<<"$database_and_owner"
	if ! "$PG_BIN/psql" \
		--host=127.0.0.1 \
		--port=5433 \
		--username="$PGADMINUSER" \
		--dbname=postgres \
		--tuples-only \
		--no-align \
		--command="SELECT 1 FROM pg_database WHERE datname = '$database'" |
		grep -qx 1; then
		"$PG_BIN/createdb" \
			--host=127.0.0.1 \
			--port=5433 \
			--username="$PGADMINUSER" \
			--owner="$owner" \
			"$database"
	fi
	"$PG_BIN/psql" \
		--host=127.0.0.1 \
		--port=5433 \
		--username="$PGADMINUSER" \
		--dbname=postgres \
		--set=ON_ERROR_STOP=1 \
		--command="REVOKE CONNECT ON DATABASE $database FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE $database TO $owner;"
done

unset PGPASSWORD PGADMINPASSWORD app_password restore_password
printf 'Production PostgreSQL identities are ready at %s.\n' "$(production_database_identity)"
printf 'Secrets remain in %s with mode 0600.\n' "$PRODUCTION_CONFIG_FILE"
