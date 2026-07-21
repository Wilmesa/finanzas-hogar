#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

node scripts/configure-domain.mjs >/dev/null
node scripts/preflight.mjs

project_name=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | tail -n 1)
deploy_target=${DEPLOY_TARGET:-$(sed -n 's/^DEPLOY_TARGET=//p' .env | tail -n 1)}
auth_mode=${AUTH_MODE:-$(sed -n 's/^AUTH_MODE=//p' .env | tail -n 1)}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$project_dir/backups/$timestamp"
mkdir -p "$backup_dir/runtime" "$backup_dir/compose"
chmod 700 "$backup_dir"

bundled_n8n_running=$(scripts/compose.sh --profile bundled-n8n ps --status running --services n8n 2>/dev/null || true)
restart_apps() {
  scripts/compose.sh up -d firefly api web gateway >/dev/null 2>&1 || true
  if [ "${auth_mode:-local}" = "keycloak" ]; then scripts/compose.sh up -d keycloak >/dev/null 2>&1 || true; fi
  if [ "$bundled_n8n_running" = "n8n" ]; then
    scripts/compose.sh --profile bundled-n8n up -d n8n >/dev/null 2>&1 || true
  fi
}
trap restart_apps EXIT INT TERM

# Pausa escritores para que bases y volúmenes correspondan al mismo punto operativo.
scripts/compose.sh --profile bundled-n8n stop api firefly n8n
if [ "${auth_mode:-local}" = "keycloak" ]; then scripts/compose.sh stop keycloak; fi

scripts/compose.sh exec -T postgres \
  pg_dumpall --clean --if-exists -U finanzas | gzip > "$backup_dir/postgres.sql.gz"

archive_volume() {
  volume_name=$1
  archive_name=$2
  if docker volume inspect "$volume_name" >/dev/null 2>&1; then
    docker run --rm \
      -v "$volume_name":/data:ro \
      -v "$backup_dir":/backup \
      alpine:3.22 tar -C /data -czf "/backup/$archive_name" .
  fi
}

archive_volume "${project_name}_firefly_upload" firefly-upload.tar.gz
archive_volume "${project_name}_redis_data" redis-data.tar.gz
archive_volume "${project_name}_n8n_data" n8n-data.tar.gz
archive_volume "${project_name}_caddy_data" caddy-data.tar.gz
archive_volume "${project_name}_caddy_config" caddy-config.tar.gz

cp .env "$backup_dir/env.secrets"
chmod 600 "$backup_dir/env.secrets"
if [ -d runtime/keycloak ]; then cp -R runtime/keycloak "$backup_dir/runtime/"; fi
cp docker-compose*.yml "$backup_dir/compose/"
scripts/compose.sh images > "$backup_dir/images.txt"

{
  echo "CREATED_AT=$timestamp"
  echo "GIT_COMMIT=$(git rev-parse HEAD)"
  echo "GIT_BRANCH=$(git branch --show-current)"
  echo "COMPOSE_PROJECT_NAME=$project_name"
  echo "DEPLOY_TARGET=$deploy_target"
  echo "AUTH_MODE=${auth_mode:-local}"
  echo "BACKUP_FORMAT=2"
} > "$backup_dir/metadata.env"

(cd "$backup_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
mkdir -p runtime/deploy
printf '%s\n' "$backup_dir" > runtime/deploy/last-backup
chmod 600 runtime/deploy/last-backup

trap - EXIT INT TERM
restart_apps

echo "Backup creado en $backup_dir"
echo "ADVERTENCIA: env.secrets contiene secretos. Mantén permisos restrictivos y copia el backup cifrado fuera del servidor."
