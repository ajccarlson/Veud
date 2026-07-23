#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/common.sh"

require_command curl
require_command findmnt
require_command gcc
require_command make
require_command openssl
require_command sha256sum
guard_live_storage
guard_backup_storage
verify_node_22

umask 077
mkdir -p \
	"$STAGING_ROOT"/{app/releases,backups,cache,config,log,run,runtime} \
	"$OFFSITE_DIR"
chmod 700 "$STAGING_ROOT" "$STAGING_ROOT/config" "$STAGING_ROOT/run" "$OFFSITE_DIR"
chmod 700 "$STAGING_ROOT"/{app,backups,cache,config,log,run,runtime}

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

if [[ ! -f "$APPLICATION_CONFIG_FILE" ]]; then
	app_password="$(openssl rand -hex 32)"
	session_secret="$(openssl rand -hex 32)"
	honeypot_secret="$(openssl rand -hex 32)"
	internal_token="$(openssl rand -hex 32)"
	cat >"$APPLICATION_CONFIG_FILE" <<EOF
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
OPENAI_TIP_OF_TONGUE_MODEL="gpt-5.6-luna"
GITHUB_CLIENT_ID="MOCK_GITHUB_CLIENT_ID"
GITHUB_CLIENT_SECRET="MOCK_GITHUB_CLIENT_SECRET"
GITHUB_TOKEN=""
EOF
	chmod 600 "$APPLICATION_CONFIG_FILE"
fi

load_application_environment

if [[ ! -f "$CONFIG_FILE" ]]; then
	load_password="$(openssl rand -hex 32)"
	restore_password="$(openssl rand -hex 32)"
	cat >"$CONFIG_FILE" <<EOF
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
	chmod 600 "$CONFIG_FILE"
fi

if [[ ! -f "$ADMIN_CONFIG_FILE" ]]; then
	cat >"$ADMIN_CONFIG_FILE" <<EOF
PGADMINUSER="veud_staging_admin"
PGADMINPASSWORD="$(openssl rand -hex 32)"
EOF
	chmod 600 "$ADMIN_CONFIG_FILE"
fi

load_staging_environment
load_admin_environment

if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
	password_file="$(mktemp "$STAGING_ROOT/config/initdb-password.XXXXXX")"
	trap 'rm -f "$password_file"' EXIT
	printf '%s\n' "$PGADMINPASSWORD" >"$password_file"
	"$PG_BIN/initdb" \
		--pgdata="$PGDATA" \
		--username="$PGADMINUSER" \
		--pwfile="$password_file" \
		--auth-local=scram-sha-256 \
		--auth-host=scram-sha-256 \
		--data-checksums \
		--encoding=UTF8 \
		--locale=C.UTF-8
	rm -f "$password_file"
	cat >>"$PGDATA/postgresql.conf" <<EOF

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
	cat >"$PGDATA/pg_hba.conf" <<EOF
local all all scram-sha-256
host  all all 127.0.0.1/32 scram-sha-256
host  all all ::1/128 reject
EOF
	chmod 700 "$PGDATA"
fi

unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-postgres.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-app.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-backup.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-backup.timer" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-mal-hydration.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-mal-hydration.timer" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-mal-inventory.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-mal-inventory.timer" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-tmdb-hydration.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-tmdb-hydration.timer" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-tmdb-inventory.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-tmdb-inventory.timer" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-catalog-backup.service" "$unit_dir/"
install -m 600 "$REPO_ROOT/ops/local-staging/systemd/veud-staging-catalog-backup.timer" "$unit_dir/"
systemctl --user daemon-reload
systemctl --user enable --now veud-staging-postgres.service

for _ in {1..30}; do
	"$PG_BIN/pg_isready" --host=127.0.0.1 --port=5433 >/dev/null 2>&1 && break
	sleep 1
done
"$PG_BIN/pg_isready" --host=127.0.0.1 --port=5433 >/dev/null || die 'PostgreSQL did not become ready'

export PGPASSWORD="$PGADMINPASSWORD"

create_or_update_role() {
	local role="$1" url="$2" password
	password="${url#*${role}:}"
	password="${password%%@*}"
	printf '%s\n' \
		"SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', '$role', '$password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$role')\\gexec" \
		"ALTER ROLE $role PASSWORD '$password';" |
		"$PG_BIN/psql" --host=127.0.0.1 --port=5433 --username="$PGADMINUSER" --dbname=postgres --set=ON_ERROR_STOP=1
}

create_or_update_role veud_staging_app "$DATABASE_URL"
create_or_update_role veud_staging_load "$STAGING_LOAD_DATABASE_URL"
create_or_update_role veud_staging_restore "$POSTGRES_BACKUP_VERIFY_URL"

for database_and_owner in \
	'veud_staging veud_staging_app' \
	'veud_staging_load veud_staging_load' \
	'veud_staging_restore veud_staging_restore'; do
	read -r database owner <<<"$database_and_owner"
	if ! "$PG_BIN/psql" --host=127.0.0.1 --port=5433 --username="$PGADMINUSER" --dbname=postgres --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '$database'" | grep -qx 1; then
		"$PG_BIN/createdb" --host=127.0.0.1 --port=5433 --username="$PGADMINUSER" --owner="$owner" "$database"
	fi
done

for database_and_owner in \
	'veud_staging veud_staging_app' \
	'veud_staging_load veud_staging_load' \
	'veud_staging_restore veud_staging_restore'; do
	read -r database owner <<<"$database_and_owner"
	"$PG_BIN/psql" --host=127.0.0.1 --port=5433 --username="$PGADMINUSER" --dbname=postgres --set=ON_ERROR_STOP=1 \
		--command="REVOKE CONNECT ON DATABASE $database FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE $database TO $owner;"
done

unset PGPASSWORD PGADMINPASSWORD
printf 'PostgreSQL %s is ready on 127.0.0.1:5433. Secrets remain under %s (mode 0600).\n' "$PG_VERSION" "$STAGING_ROOT/config"
printf 'Next: run ops/local-staging/deploy.sh after committing the candidate release.\n'
