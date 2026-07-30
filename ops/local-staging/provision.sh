#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/common.sh"

require_command curl
require_command cmp
require_command findmnt
require_command flock
require_command gcc
require_command install
require_command make
require_command openssl
require_command sed
require_command sha256sum
require_command sync
require_command systemctl
guard_live_storage
guard_backup_storage
verify_node_22

umask 077
mkdir -p \
	"$STAGING_ROOT"/{app/releases,backups,cache,config,log,run,runtime} \
	"$OFFSITE_DIR"
chmod 700 "$STAGING_ROOT" "$STAGING_ROOT/config" "$STAGING_ROOT/run" "$OFFSITE_DIR"
chmod 700 "$STAGING_ROOT"/{app,backups,cache,config,log,run,runtime}
cutover_acquire_deployment_lock \
	"$STAGING_ROOT/run/provenance-cutover-deploy.lock" \
	'Staging provisioning cannot run during a catalog deployment'
provision_lock_wait="${VEUD_STAGING_PROVISION_LOCK_WAIT_SECONDS:-120}"
[[ "$provision_lock_wait" =~ ^[1-9][0-9]*$ ]] ||
	die 'VEUD_STAGING_PROVISION_LOCK_WAIT_SECONDS must be a positive integer'
exec 6>"$STAGING_ROOT/run/catalog-writer-lifetime.lock"
flock --exclusive --wait "$provision_lock_wait" 6 ||
	die 'Timed out draining supported staging database writers'
for cutover_state in \
	"$STAGING_ROOT/run/provenance-cutover-incomplete" \
	"$STAGING_ROOT/run/provenance-cutover-emergency-block" \
	"$STAGING_ROOT/run/provenance-cutover-completion-cleanup"; do
	[[ ! -e "$cutover_state" && ! -L "$cutover_state" ]] ||
		die "Staging provisioning is blocked by cutover state: $cutover_state"
done

if [[ ! -x "$PG_BIN/postgres" ]]; then
	build_root="$(mktemp -d "/tmp/veud-postgresql-$PG_VERSION.XXXXXX")"
	trap 'rm -rf "$build_root"' EXIT
	archive="postgresql-$PG_VERSION.tar.bz2"
	base_url="https://ftp.postgresql.org/pub/source/v$PG_VERSION"
	printf 'Downloading PostgreSQL %s from the official release archive...\n' "$PG_VERSION"
	curl --fail --location --silent --show-error "$base_url/$archive" --output "$build_root/$archive"
	curl --fail --location --silent --show-error "$base_url/$archive.sha256" --output "$build_root/$archive.sha256"
	(cd "$build_root" && sha256sum --check "$archive.sha256")
	tar -xjf "$build_root/$archive" -C "$build_root"
	(
		cd "$build_root/postgresql-$PG_VERSION"
		./configure --prefix="$PG_PREFIX" --with-openssl --with-lz4 --with-zstd
		make -j "$(nproc)"
		make install
		make -C contrib/pg_trgm -j "$(nproc)"
		make -C contrib/pg_trgm install
	)
fi

if [[ -e "$APPLICATION_CONFIG_FILE" || -L "$APPLICATION_CONFIG_FILE" ]]; then
	[[ -f "$APPLICATION_CONFIG_FILE" && ! -L "$APPLICATION_CONFIG_FILE" ]] ||
		die 'Application configuration is not a regular non-symlink file'
else
	app_password="$(openssl rand -hex 32)"
	session_secret="$(openssl rand -hex 32)"
	honeypot_secret="$(openssl rand -hex 32)"
	internal_token="$(openssl rand -hex 32)"
	application_config_temporary="$(
		cutover_new_private_temporary "$(dirname "$APPLICATION_CONFIG_FILE")"
	)"
	cat >"$application_config_temporary" <<EOF
DATABASE_PATH="$STAGING_ROOT/unused-sqlite.db"
DATABASE_URL="postgresql://veud_staging_app:$app_password@127.0.0.1:5433/veud_staging?schema=public"
CACHE_DATABASE_PATH="$STAGING_ROOT/cache/cache.db"
PORT="4022"
HOST="127.0.0.1"
NODE_ENV="production"
SESSION_SECRET="$session_secret"
HONEYPOT_SECRET="$honeypot_secret"
INTERNAL_COMMAND_TOKEN="$internal_token"
RESEND_API_KEY=""
VEUD_ORIGIN="https://staging.veud.net"
SENTRY_DSN=""
TMDB_API_KEY=""
TRAKT_API_KEY=""
TRAKT_CLIENT_SECRET=""
TRAKT_ACCESS_TOKEN_MAIN=""
TRAKT_ACCESS_TOKEN_BACKUP=""
MAL_CLIENT_ID=""
MAL_CLIENT_SECRET=""
MAL_USER=""
MAL_CATALOG_POLICY_APPROVAL_REF="OWNER-MAL-API-AGREEMENT-2026-07-22"
ANILIST_CLIENT_ID=""
ANILIST_CLIENT_SECRET=""
OPENAI_API_KEY=""
OPENAI_DEFAULT_MODEL="gpt-5.6-luna"
OPENAI_TIP_OF_TONGUE_MODEL="gpt-5.6-luna"
VEUD_AI_ENABLED="true"
VEUD_AI_MAX_CONCURRENCY="4"
VEUD_AI_TIP_OF_TONGUE_ENABLED="true"
VEUD_AI_NATURAL_LANGUAGE_DISCOVERY_ENABLED="true"
VEUD_AI_DISCOVERY_REFINEMENT_ENABLED="true"
VEUD_AI_TRACKING_COMMAND_ENABLED="true"
VEUD_AI_IMAGE_TIP_OF_TONGUE_ENABLED="true"
VEUD_AI_IMPORT_RECONCILIATION_ENABLED="true"
VEUD_AI_REVIEW_ASSISTANCE_ENABLED="true"
VEUD_AI_MODERATION_TRIAGE_ENABLED="true"
EOF
	for required_key in \
		DATABASE_URL SESSION_SECRET HONEYPOT_SECRET INTERNAL_COMMAND_TOKEN \
		PORT HOST NODE_ENV VEUD_ORIGIN; do
		[[ "$(grep -c "^$required_key=" "$application_config_temporary")" == 1 ]] ||
			die "Staging application configuration is missing exactly one $required_key"
	done
	grep -q '^DATABASE_URL="postgresql://veud_staging_app:[0-9a-f]\{64\}@127\.0\.0\.1:5433/veud_staging?schema=public"$' \
		"$application_config_temporary" ||
		die 'Staging application DATABASE_URL is not the exact expected form'
	for secret_key in SESSION_SECRET HONEYPOT_SECRET INTERNAL_COMMAND_TOKEN; do
		grep -q "^$secret_key=\"[0-9a-f]\{64\}\"$" "$application_config_temporary" ||
			die "Staging $secret_key is not an exact 32-byte hex secret"
	done
	cutover_publish_new_private_file \
		"$application_config_temporary" \
		"$APPLICATION_CONFIG_FILE"
fi

load_application_environment
application_database_url="$DATABASE_URL"

if [[ -e "$CONFIG_FILE" || -L "$CONFIG_FILE" ]]; then
	[[ -f "$CONFIG_FILE" && ! -L "$CONFIG_FILE" ]] ||
		die 'Staging operations configuration is not a regular non-symlink file'
else
	load_password="$(openssl rand -hex 32)"
	restore_password="$(openssl rand -hex 32)"
	operations_config_temporary="$(
		cutover_new_private_temporary "$(dirname "$CONFIG_FILE")"
	)"
	cat >"$operations_config_temporary" <<EOF
VEUD_STAGING_ROOT="$STAGING_ROOT"
PG_VERSION="$PG_VERSION"
PG_BIN="$PG_BIN"
PGDATA="$PGDATA"
PGSOCKET="$PGSOCKET"
PGLOG="$PGLOG"
PGHOST="127.0.0.1"
PGPORT="5433"
DATABASE_URL="$DATABASE_URL"
STAGING_LOAD_DATABASE_URL="postgresql://veud_staging_load:$load_password@127.0.0.1:5433/veud_staging_load?schema=public"
POSTGRES_BACKUP_VERIFY_URL="postgresql://veud_staging_restore:$restore_password@127.0.0.1:5433/veud_staging_restore?schema=public"
BACKUP_DIR="$STAGING_ROOT/backups"
BACKUP_KEEP="14"
BACKUP_OFFSITE_DIR="$OFFSITE_DIR"
BACKUP_OFFSITE_KEEP="30"
BACKUP_OFFSITE_MOUNTPOINT="$BACKUP_MOUNT"
BACKUP_OFFSITE_MIN_FREE_BYTES="53687091200"
PG_DUMP_BIN="$PG_BIN/pg_dump"
PG_RESTORE_BIN="$PG_BIN/pg_restore"
PSQL_BIN="$PG_BIN/psql"
EOF
	for required_key in \
		VEUD_STAGING_ROOT PG_BIN PGDATA DATABASE_URL \
		STAGING_LOAD_DATABASE_URL POSTGRES_BACKUP_VERIFY_URL \
		BACKUP_DIR BACKUP_OFFSITE_MOUNTPOINT PSQL_BIN; do
		[[ "$(grep -c "^$required_key=" "$operations_config_temporary")" == 1 ]] ||
			die "Staging operations configuration is missing exactly one $required_key"
	done
	cutover_publish_new_private_file \
		"$operations_config_temporary" \
		"$CONFIG_FILE"
fi

if [[ -e "$ADMIN_CONFIG_FILE" || -L "$ADMIN_CONFIG_FILE" ]]; then
	[[ -f "$ADMIN_CONFIG_FILE" && ! -L "$ADMIN_CONFIG_FILE" ]] ||
		die 'Staging admin configuration is not a regular non-symlink file'
else
	admin_config_temporary="$(
		cutover_new_private_temporary "$(dirname "$ADMIN_CONFIG_FILE")"
	)"
	cat >"$admin_config_temporary" <<EOF
PGADMINUSER="veud_staging_admin"
PGADMINPASSWORD="$(openssl rand -hex 32)"
EOF
	grep -q '^PGADMINPASSWORD="[0-9a-f]\{64\}"$' "$admin_config_temporary" ||
		die 'Staging admin password is not an exact 32-byte hex secret'
	cutover_publish_new_private_file \
		"$admin_config_temporary" \
		"$ADMIN_CONFIG_FILE"
fi

load_staging_environment
load_admin_environment
operations_database_url="$DATABASE_URL"
assert_staging_database_identities \
	"$application_database_url" \
	"$operations_database_url" \
	"$STAGING_LOAD_DATABASE_URL" \
	"$POSTGRES_BACKUP_VERIFY_URL"

staging_postgres_environment=(
	/usr/bin/env
	-i
	"HOME=$HOME"
	"PATH=$PG_BIN:/usr/bin:/bin"
	'LANG=C.UTF-8'
	'LC_ALL=C.UTF-8'
)

run_staging_admin_psql() {
	"${staging_postgres_environment[@]}" \
		"PGPASSWORD=$PGADMINPASSWORD" \
		'PGPASSFILE=/dev/null' \
		'PGAPPNAME=veud-staging-provision' \
		'PGOPTIONS=-csearch_path=pg_catalog' \
		"$PG_BIN/psql" \
		--no-psqlrc \
		--host=127.0.0.1 \
		--port=5433 \
		--username="$PGADMINUSER" \
		"$@"
}

run_staging_admin_createdb() {
	"${staging_postgres_environment[@]}" \
		"PGPASSWORD=$PGADMINPASSWORD" \
		'PGPASSFILE=/dev/null' \
		'PGAPPNAME=veud-staging-provision' \
		'PGOPTIONS=-csearch_path=pg_catalog' \
		"$PG_BIN/createdb" \
		--host=127.0.0.1 \
		--port=5433 \
		--username="$PGADMINUSER" \
		"$@"
}

# The managed cluster is initialized in a sibling directory, configured
# completely, then given a synced completion marker and renamed into place, so
# an interrupted provision never leaves a half-initialized PGDATA that a later
# run would treat as established. An existing PGDATA must attest the exact
# managed marker or the run fails closed rather than rewriting unknown data.
PGDATA_MANAGED_MARKER="$PGDATA/veud-managed-cluster.marker"
PGDATA_MANAGED_MARKER_VALUE="veud-staging-postgres-16.14-managed-v1"

if [[ -e "$PGDATA" || -L "$PGDATA" ]]; then
	[[ -d "$PGDATA" && ! -L "$PGDATA" ]] ||
		die 'Managed staging PGDATA is not a regular directory'
	if [[ -f "$PGDATA/PG_VERSION" ]]; then
		# The managed profile itself is an attestation: a cluster carrying this
		# exact configuration was initialized by this script before markers
		# existed, so adopt it by recording the marker. Anything else is unknown
		# established data and must never be rewritten.
		[[ -f "$PGDATA/postgresql.conf" && ! -L "$PGDATA/postgresql.conf" ]] ||
			die 'Existing staging PGDATA has no regular postgresql.conf'
		grep -q "^unix_socket_directories = '$PGSOCKET'$" "$PGDATA/postgresql.conf" ||
			die 'Existing staging PGDATA is not configured by this managed profile; refusing to rewrite unknown data'
		grep -q "^log_directory = '$PGLOG'$" "$PGDATA/postgresql.conf" ||
			die 'Existing staging PGDATA logging profile does not match the managed configuration'
		[[ "$(cat "$PGDATA/PG_VERSION")" == 16 ]] ||
			die 'Existing staging PGDATA is not a PostgreSQL 16 cluster'
		if [[ -e "$PGDATA_MANAGED_MARKER" || -L "$PGDATA_MANAGED_MARKER" ]]; then
			[[ -f "$PGDATA_MANAGED_MARKER" && ! -L "$PGDATA_MANAGED_MARKER" ]] ||
				die 'Staging PGDATA managed marker is not a regular non-symlink file'
			[[ "$(cat "$PGDATA_MANAGED_MARKER")" == "$PGDATA_MANAGED_MARKER_VALUE" ]] ||
				die 'Existing staging PGDATA marker does not attest the exact managed configuration'
		else
			marker_temporary="$(cutover_new_private_temporary "$PGDATA")"
			printf '%s\n' "$PGDATA_MANAGED_MARKER_VALUE" >"$marker_temporary"
			cutover_publish_new_private_file \
				"$marker_temporary" \
				"$PGDATA_MANAGED_MARKER"
		fi
	else
		# A previous attempt was interrupted before completion. Sibling
		# initialization means this script can only ever leave an EMPTY
		# directory here, so remove exactly that. Anything with content is
		# unattested data an operator placed here and must never be destroyed.
		[[ ! -f "$PGDATA_MANAGED_MARKER" ]] ||
			die 'Staging PGDATA marker exists without an initialized cluster'
		rmdir "$PGDATA" 2>/dev/null ||
			die 'Refusing to discard a non-empty unattested staging PGDATA; remove it manually after verifying its contents'
		sync -f "$(dirname "$PGDATA")"
	fi
fi

if [[ ! -d "$PGDATA" ]]; then
	pgdata_staging="$PGDATA.initializing"
	cutover_remove_tree_durable "$pgdata_staging"
	mkdir -p "$pgdata_staging"
	chmod 700 "$pgdata_staging"
	password_file="$(mktemp "$STAGING_ROOT/config/initdb-password.XXXXXX")"
	trap 'rm -f "$password_file"' EXIT
	printf '%s\n' "$PGADMINPASSWORD" >"$password_file"
	"${staging_postgres_environment[@]}" "$PG_BIN/initdb" \
		--pgdata="$pgdata_staging" \
		--username="$PGADMINUSER" \
		--pwfile="$password_file" \
		--auth-local=scram-sha-256 \
		--auth-host=scram-sha-256 \
		--data-checksums \
		--encoding=UTF8 \
		--locale=C.UTF-8
	rm -f "$password_file"
	cat >>"$pgdata_staging/postgresql.conf" <<EOF

# Veud isolated local staging profile.
listen_addresses = '127.0.0.1'
port = 5433
unix_socket_directories = '$PGSOCKET'
password_encryption = 'scram-sha-256'
max_connections = 100
shared_buffers = '2GB'
effective_cache_size = '8GB'
maintenance_work_mem = '1GB'
work_mem = '16MB'
min_wal_size = '1GB'
max_wal_size = '8GB'
checkpoint_timeout = '15min'
random_page_cost = 1.1
logging_collector = on
log_directory = '$PGLOG'
log_filename = 'postgresql-%Y-%m-%d.log'
log_rotation_age = '1d'
log_truncate_on_rotation = on
log_min_duration_statement = 2000
EOF
	cat >"$pgdata_staging/pg_hba.conf" <<EOF
local all all scram-sha-256
host  all all 127.0.0.1/32 scram-sha-256
host  all all ::1/128 reject
EOF
	chmod 700 "$pgdata_staging"
	printf '%s\n' "$PGDATA_MANAGED_MARKER_VALUE" \
		>"$pgdata_staging/veud-managed-cluster.marker"
	chmod 600 "$pgdata_staging/veud-managed-cluster.marker"
	# Flush the fully configured tree, then publish it with one atomic rename.
	cutover_sync_tree "$pgdata_staging"
	[[ ! -e "$PGDATA" && ! -L "$PGDATA" ]] ||
		die 'Managed staging PGDATA appeared while it was being initialized'
	mv "$pgdata_staging" "$PGDATA"
	cutover_sync_path_and_parent "$PGDATA"
fi

unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"

cutover_units=(
	veud-staging-app.service
	veud-staging-backup.service
	veud-staging-backup.timer
	veud-staging-mal-hydration.service
	veud-staging-mal-hydration.timer
	veud-staging-mal-inventory.service
	veud-staging-mal-inventory.timer
	veud-staging-mal-trending.service
	veud-staging-mal-trending.timer
	veud-staging-tmdb-hydration.service
	veud-staging-tmdb-hydration.timer
	veud-staging-tmdb-inventory.service
	veud-staging-tmdb-inventory.timer
	veud-staging-catalog-backup.service
	veud-staging-catalog-backup.timer
	veud-staging-notification-digests.service
	veud-staging-notification-digests.timer
)

# Preflight every managed unit BEFORE publishing or replacing any of them. The
# PostgreSQL unit used to be installed first, so a later immutability failure
# left a replaced unit behind on an otherwise refused provision.
managed_units=(veud-staging-postgres.service "${cutover_units[@]}")
for unit in "${managed_units[@]}"; do
	[[ ! -L "$unit_dir/$unit" ]] ||
		die "Managed staging systemd unit target is a symlink: $unit"
	[[ ! -e "$unit_dir/$unit" || -f "$unit_dir/$unit" ]] ||
		die "Managed staging systemd unit target is not a regular file: $unit"
	# Drop-ins can silently replace ExecStart on an otherwise managed unit.
	[[ ! -e "$unit_dir/$unit.d" ]] ||
		die "Systemd drop-ins are forbidden for managed staging unit: $unit"
done
[[ -f "$REPO_ROOT/ops/local-staging/systemd/veud-staging-postgres.service" &&
	! -L "$REPO_ROOT/ops/local-staging/systemd/veud-staging-postgres.service" ]] ||
	die 'Managed staging PostgreSQL unit definition is missing'

current="$STAGING_ROOT/app/current"
rendered_units=''
if [[ -L "$current" ]]; then
	active_release_id="$(
		cutover_active_release_id "$current" "$STAGING_ROOT/app/releases"
	)" ||
		die 'Active staging release identity is invalid during provisioning'
	active_release="$STAGING_ROOT/app/releases/$active_release_id"
	rendered_units="$(mktemp -d "$STAGING_ROOT/run/provision-units.XXXXXX")"
	trap 'rm -rf "$rendered_units"' EXIT
	for unit in "${cutover_units[@]}"; do
		[[ -f "$active_release/ops/local-staging/systemd/$unit" &&
			! -L "$active_release/ops/local-staging/systemd/$unit" ]] ||
			die "Active staging release is missing unit definition: $unit"
		sed \
			"s|%h/Programs/Veud/ops/local-staging|$active_release/ops/local-staging|g" \
			"$active_release/ops/local-staging/systemd/$unit" \
			>"$rendered_units/$unit"
		[[ -f "$unit_dir/$unit" && ! -L "$unit_dir/$unit" ]] &&
			cmp -s "$rendered_units/$unit" "$unit_dir/$unit" ||
			die "Provisioning refuses to replace immutable active unit: $unit"
	done
elif [[ -e "$current" ]]; then
	die 'Staging current path exists but is not an immutable release symlink'
fi

# Every preflight passed: publish atomically. Rendering into the destination
# directory keeps the rename on one filesystem, so no partial unit can be
# observed by systemd.
publish_managed_unit() {
	local source_definition="$1" unit="$2" temporary
	temporary="$(umask 077 && mktemp "$unit_dir/.veud-unit.XXXXXXXX")"
	cat "$source_definition" >"$temporary"
	chmod 600 "$temporary"
	sync -f "$temporary"
	mv -f "$temporary" "$unit_dir/$unit"
	cutover_sync_path_and_parent "$unit_dir/$unit"
}

publish_managed_unit \
	"$REPO_ROOT/ops/local-staging/systemd/veud-staging-postgres.service" \
	veud-staging-postgres.service

if [[ ! -L "$current" ]]; then
	for unit in "${cutover_units[@]}"; do
		publish_managed_unit \
			"$REPO_ROOT/ops/local-staging/systemd/$unit" \
			"$unit"
	done
fi
systemctl --user daemon-reload
cutover_verify_effective_immutable_units \
	"$unit_dir" \
	"$REPO_ROOT/ops/local-staging" \
	'__no-mutable-postgres-unit-prefix__' \
	veud-staging-postgres.service ||
	die 'Effective staging PostgreSQL unit does not match its managed definition'
if [[ -L "$current" ]]; then
	cutover_verify_effective_immutable_units \
		"$unit_dir" \
		"$active_release/ops/local-staging" \
		"$REPO_ROOT/ops/local-staging" \
		"${cutover_units[@]}" ||
		die 'Effective staging units do not match the immutable active release'
else
	cutover_verify_effective_immutable_units \
		"$unit_dir" \
		"$REPO_ROOT/ops/local-staging" \
		'__no-mutable-bootstrap-unit-prefix__' \
		"${cutover_units[@]}" ||
		die 'Effective staging bootstrap units do not match their managed definitions'
fi
systemctl --user enable --now veud-staging-postgres.service

for _ in {1..30}; do
	"${staging_postgres_environment[@]}" \
		"$PG_BIN/pg_isready" \
		--host=127.0.0.1 \
		--port=5433 >/dev/null 2>&1 &&
		break
	sleep 1
done
"${staging_postgres_environment[@]}" \
	"$PG_BIN/pg_isready" \
	--host=127.0.0.1 \
	--port=5433 >/dev/null ||
	die 'PostgreSQL did not become ready'

run_staging_admin_psql \
	--dbname=postgres \
	--set=ON_ERROR_STOP=1 \
	--quiet \
	--command="
		SELECT 1 / CASE WHEN (
			NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_stat_activity AS activity
				WHERE activity.datname IN (
					'veud_staging',
					'veud_staging_load',
					'veud_staging_restore'
				)
			) AND
			NOT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_prepared_xacts AS prepared
				WHERE prepared.database IN (
					'veud_staging',
					'veud_staging_load',
					'veud_staging_restore'
				)
			)
		) THEN 1 ELSE 0 END;
	" \
	>/dev/null
for database_and_owner in \
	'veud_staging veud_staging_app' \
	'veud_staging_load veud_staging_load' \
	'veud_staging_restore veud_staging_restore'; do
	read -r database owner <<<"$database_and_owner"
	existing_database_owner="$(
		run_staging_admin_psql \
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
		die "Existing staging database $database is owned by $existing_database_owner, not $owner"
done

create_or_update_role() {
	local role="$1" url="$2" password
	password="${url#*${role}:}"
	password="${password%%@*}"
	[[ "$password" =~ ^[0-9a-f]{64}$ ]] ||
		die "Staging PostgreSQL URL for $role must retain its generated hexadecimal password"
	printf '%s\n' \
		"SELECT pg_catalog.format('CREATE ROLE %I LOGIN PASSWORD %L', '$role', '$password') WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$role')\\gexec" \
		"DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role WHERE role.rolname = '$role' AND (role.rolsuper OR NOT role.rolinherit OR role.rolcreaterole OR role.rolcreatedb OR NOT role.rolcanlogin OR role.rolreplication OR role.rolbypassrls OR role.rolconnlimit <> -1 OR role.rolvaliduntil IS NOT NULL OR role.rolconfig IS NOT NULL)) OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role JOIN pg_catalog.pg_auth_members AS membership ON membership.member = role.oid OR membership.roleid = role.oid WHERE role.rolname = '$role') OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role JOIN pg_catalog.pg_db_role_setting AS setting ON setting.setrole = role.oid WHERE role.rolname = '$role') OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role JOIN pg_catalog.pg_shdescription AS description ON description.classoid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND description.objoid = role.oid WHERE role.rolname = '$role') OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role JOIN pg_catalog.pg_shseclabel AS label ON label.classoid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND label.objoid = role.oid WHERE role.rolname = '$role') THEN RAISE EXCEPTION 'Staging PostgreSQL role is not least privilege'; END IF; END \$\$;" \
		"ALTER ROLE $role WITH LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD '$password';" |
		run_staging_admin_psql --dbname=postgres --set=ON_ERROR_STOP=1
}

create_or_update_role veud_staging_app "$application_database_url"
create_or_update_role veud_staging_load "$STAGING_LOAD_DATABASE_URL"
create_or_update_role veud_staging_restore "$POSTGRES_BACKUP_VERIFY_URL"

for database_and_owner in \
	'veud_staging veud_staging_app' \
	'veud_staging_load veud_staging_load' \
	'veud_staging_restore veud_staging_restore'; do
	read -r database owner <<<"$database_and_owner"
	database_owner="$(
		run_staging_admin_psql \
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
		run_staging_admin_createdb --owner="$owner" "$database"
	elif [[ "$database_owner" != "$owner" ]]; then
		die "Existing staging database $database is owned by $database_owner, not $owner"
	fi
done

for database_and_owner in \
	'veud_staging veud_staging_app' \
	'veud_staging_load veud_staging_load' \
	'veud_staging_restore veud_staging_restore'; do
	read -r database owner <<<"$database_and_owner"
	run_staging_admin_psql \
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

unset PGADMINPASSWORD
printf 'PostgreSQL %s is ready on 127.0.0.1:5433. Secrets remain under %s (mode 0600).\n' "$PG_VERSION" "$STAGING_ROOT/config"
printf 'Next: run ops/local-staging/deploy.sh after committing the candidate release.\n'
