#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/common.sh"

guard_live_storage
guard_backup_storage
verify_node_22
require_command openssl
require_command flock

umask 077
mkdir -p \
	"$PRODUCTION_ROOT/config" \
	"$PRODUCTION_ROOT/run" \
	"$PRODUCTION_BACKUP_DIR" \
	"$PRODUCTION_OFFSITE_DIR"
chmod 700 \
	"$PRODUCTION_ROOT" \
	"$PRODUCTION_ROOT/config" \
	"$PRODUCTION_ROOT/run" \
	"$PRODUCTION_BACKUP_DIR" \
	"$PRODUCTION_OFFSITE_DIR"
cutover_acquire_deployment_lock \
	"$PRODUCTION_ROOT/run/catalog-release-deploy.lock" \
	'Production provisioning cannot run during a catalog deployment'
for cutover_state in \
	"$PRODUCTION_ROOT/run/catalog-release-preparation.state" \
	"$PRODUCTION_ROOT/run/catalog-release-maintenance.state" \
	"$PRODUCTION_ROOT/run/catalog-release-emergency-block.state" \
	"$PRODUCTION_ROOT/run/catalog-release-completion-cleanup.state"; do
	[[ ! -e "$cutover_state" && ! -L "$cutover_state" ]] ||
		die "Production provisioning is blocked by cutover state: $cutover_state"
done
provision_lock_wait="${VEUD_PRODUCTION_PROVISION_LOCK_WAIT_SECONDS:-120}"
[[ "$provision_lock_wait" =~ ^[1-9][0-9]*$ ]] ||
	die 'VEUD_PRODUCTION_PROVISION_LOCK_WAIT_SECONDS must be a positive integer'
exec 6>"$PRODUCTION_ROOT/run/catalog-writer-lifetime.lock"
flock --exclusive --wait "$provision_lock_wait" 6 ||
	die 'Timed out draining supported production database writers'

if [[ -e "$PRODUCTION_CONFIG_FILE" || -L "$PRODUCTION_CONFIG_FILE" ]]; then
	[[ -f "$PRODUCTION_CONFIG_FILE" && ! -L "$PRODUCTION_CONFIG_FILE" ]] ||
		die 'Production PostgreSQL configuration is not a regular non-symlink file'
else
	app_password="$(openssl rand -hex 32)"
	restore_password="$(openssl rand -hex 32)"
	production_config_temporary="$(
		cutover_new_private_temporary "$(dirname "$PRODUCTION_CONFIG_FILE")"
	)"
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
	} >"$production_config_temporary"
	# Validate the exact published contract before it can ever be loaded.
	for required_key in \
		DATABASE_URL \
		POSTGRES_BACKUP_VERIFY_URL \
		BACKUP_DIR \
		BACKUP_KEEP \
		BACKUP_OFFSITE_DIR \
		BACKUP_OFFSITE_KEEP \
		BACKUP_OFFSITE_MOUNTPOINT \
		BACKUP_OFFSITE_MIN_FREE_BYTES \
		PG_DUMP_BIN \
		PG_RESTORE_BIN \
		PSQL_BIN; do
		[[ "$(grep -c "^$required_key=" "$production_config_temporary")" == 1 ]] ||
			die "Production configuration is missing exactly one $required_key"
	done
	grep -q '^DATABASE_URL="postgresql://veud_production_app:[0-9a-f]\{64\}@127\.0\.0\.1:5433/veud_production?schema=public"$' \
		"$production_config_temporary" ||
		die 'Production configuration DATABASE_URL is not the exact expected form'
	grep -q '^POSTGRES_BACKUP_VERIFY_URL="postgresql://veud_production_restore:[0-9a-f]\{64\}@127\.0\.0\.1:5433/veud_production_restore?schema=public"$' \
		"$production_config_temporary" ||
		die 'Production configuration verify URL is not the exact expected form'
	cutover_publish_new_private_file \
		"$production_config_temporary" \
		"$PRODUCTION_CONFIG_FILE"
fi

load_production_environment
load_admin_environment

production_postgres_environment=(
	/usr/bin/env
	-i
	"HOME=$HOME"
	"PATH=$PG_BIN:/usr/bin:/bin"
	'LANG=C.UTF-8'
	'LC_ALL=C.UTF-8'
)

run_production_admin_psql() {
	"${production_postgres_environment[@]}" \
		"PGPASSWORD=$PGADMINPASSWORD" \
		'PGPASSFILE=/dev/null' \
		'PGAPPNAME=veud-production-provision' \
		'PGOPTIONS=-csearch_path=pg_catalog' \
		"$PG_BIN/psql" \
		--no-psqlrc \
		--host=127.0.0.1 \
		--port=5433 \
		--username="$PGADMINUSER" \
		"$@"
}

run_production_admin_createdb() {
	"${production_postgres_environment[@]}" \
		"PGPASSWORD=$PGADMINPASSWORD" \
		'PGPASSFILE=/dev/null' \
		'PGAPPNAME=veud-production-provision' \
		'PGOPTIONS=-csearch_path=pg_catalog' \
		"$PG_BIN/createdb" \
		--host=127.0.0.1 \
		--port=5433 \
		--username="$PGADMINUSER" \
		"$@"
}

"${production_postgres_environment[@]}" \
	"$PG_BIN/pg_isready" \
	--host=127.0.0.1 \
	--port=5433 >/dev/null ||
	die 'The local PostgreSQL service is not ready'

app_password="${DATABASE_URL#*veud_production_app:}"
app_password="${app_password%%@*}"
restore_password="${POSTGRES_BACKUP_VERIFY_URL#*veud_production_restore:}"
restore_password="${restore_password%%@*}"
[[ "$app_password" =~ ^[0-9a-f]{64}$ &&
	"$restore_password" =~ ^[0-9a-f]{64}$ ]] ||
	die 'Production PostgreSQL URLs must retain generated hexadecimal passwords'

run_production_admin_psql \
	--dbname=postgres \
	--set=ON_ERROR_STOP=1 \
	--quiet \
	--command="
		SELECT 1 / CASE WHEN (
			NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_stat_activity AS activity
				WHERE activity.datname IN (
					'veud_production',
					'veud_production_restore'
				)
			) AND
			NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_prepared_xacts AS prepared
				WHERE prepared.database IN (
					'veud_production',
					'veud_production_restore'
				)
			)
		) THEN 1 ELSE 0 END;
	" \
	>/dev/null
for database_and_owner in \
	'veud_production veud_production_app' \
	'veud_production_restore veud_production_restore'; do
	read -r database owner <<<"$database_and_owner"
	existing_database_owner="$(
		run_production_admin_psql \
			--dbname=postgres \
			--tuples-only \
			--no-align \
			--command="
				SELECT pg_catalog.pg_get_userbyid(database_object.datdba)
				FROM pg_catalog.pg_database AS database_object
				WHERE database_object.datname = '$database';
			"
	)"
	[[ -z "$existing_database_owner" ||
		"$existing_database_owner" == "$owner" ]] ||
		die "Existing production database $database is owned by $existing_database_owner, not $owner"
done
{
	printf '%s\n' \
		"SELECT pg_catalog.format('CREATE ROLE %I LOGIN PASSWORD %L', 'veud_production_app', '$app_password') WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'veud_production_app')\\gexec" \
		"SELECT pg_catalog.format('CREATE ROLE %I LOGIN PASSWORD %L', 'veud_production_restore', '$restore_password') WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'veud_production_restore')\\gexec" \
		"DO \$\$ DECLARE candidate pg_catalog.name; BEGIN FOREACH candidate IN ARRAY ARRAY['veud_production_app','veud_production_restore']::pg_catalog.name[] LOOP IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role WHERE role.rolname = candidate AND (role.rolsuper OR NOT role.rolinherit OR role.rolcreaterole OR role.rolcreatedb OR NOT role.rolcanlogin OR role.rolreplication OR role.rolbypassrls OR role.rolconnlimit <> -1 OR role.rolvaliduntil IS NOT NULL OR role.rolconfig IS NOT NULL)) OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role JOIN pg_catalog.pg_auth_members AS membership ON membership.member = role.oid OR membership.roleid = role.oid WHERE role.rolname = candidate) OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role JOIN pg_catalog.pg_db_role_setting AS setting ON setting.setrole = role.oid WHERE role.rolname = candidate) OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role JOIN pg_catalog.pg_shdescription AS description ON description.classoid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND description.objoid = role.oid WHERE role.rolname = candidate) OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role JOIN pg_catalog.pg_shseclabel AS label ON label.classoid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND label.objoid = role.oid WHERE role.rolname = candidate) THEN RAISE EXCEPTION 'Production PostgreSQL role % is not least privilege', candidate; END IF; END LOOP; END \$\$;" \
		"ALTER ROLE veud_production_app WITH LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD '$app_password';" \
		"ALTER ROLE veud_production_restore WITH LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD '$restore_password';"
} | run_production_admin_psql \
	--dbname=postgres \
	--set=ON_ERROR_STOP=1

for database_and_owner in \
	'veud_production veud_production_app' \
	'veud_production_restore veud_production_restore'; do
	read -r database owner <<<"$database_and_owner"
	database_owner="$(
		run_production_admin_psql \
		--dbname=postgres \
		--tuples-only \
		--no-align \
			--command="
				SELECT pg_catalog.pg_get_userbyid(database_object.datdba)
				FROM pg_catalog.pg_database AS database_object
				WHERE database_object.datname = '$database';
			"
	)"
	if [[ -z "$database_owner" ]]; then
		run_production_admin_createdb \
			--owner="$owner" \
			"$database"
	elif [[ "$database_owner" != "$owner" ]]; then
		die "Existing production database $database is owned by $database_owner, not $owner"
	fi
	run_production_admin_psql \
		--dbname=postgres \
		--set=ON_ERROR_STOP=1 \
		--command="
			SELECT 1 / CASE WHEN (
				SELECT pg_catalog.pg_get_userbyid(database_object.datdba) = '$owner'
				FROM pg_catalog.pg_database AS database_object
				WHERE database_object.datname = '$database'
			) THEN 1 ELSE 0 END;
			REVOKE CONNECT ON DATABASE $database FROM PUBLIC;
			GRANT CONNECT, TEMPORARY ON DATABASE $database TO $owner;
		"
done

unset PGADMINPASSWORD app_password restore_password
printf 'Production PostgreSQL identities are ready at %s.\n' "$(production_database_identity)"
printf 'Secrets remain in %s with mode 0600.\n' "$PRODUCTION_CONFIG_FILE"
