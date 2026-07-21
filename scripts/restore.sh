#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Uso: RESTORE_CONFIRM=SI_RESTAURAR scripts/restore.sh /ruta/al/backup" >&2
  exit 2
fi
if [ "${RESTORE_CONFIRM:-}" != "SI_RESTAURAR" ]; then
  echo "Restauración cancelada: falta RESTORE_CONFIRM=SI_RESTAURAR" >&2
  exit 2
fi

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_dir=$(CDPATH= cd -- "$1" && pwd)
cd "$project_dir"

(cd "$backup_dir" && sha256sum -c SHA256SUMS)
metadata_value() {
  sed -n "s/^$1=//p" "$backup_dir/metadata.env" | tail -n 1
}
backup_format=$(metadata_value BACKUP_FORMAT)
backup_project=$(metadata_value COMPOSE_PROJECT_NAME)
backup_target=$(metadata_value DEPLOY_TARGET)
backup_commit=$(metadata_value GIT_COMMIT)
if [ "$backup_format" != "2" ]; then
  echo "Formato de backup incompatible" >&2
  exit 1
fi

current_project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | tail -n 1)
if [ "$current_project" != "$backup_project" ] && [ "${RESTORE_ALLOW_PROJECT_MISMATCH:-}" != "YES" ]; then
  echo "El backup pertenece a $backup_project y el entorno actual a $current_project." >&2
  echo "Usa RESTORE_ALLOW_PROJECT_MISMATCH=YES solo después de revisar los volúmenes destino." >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$backup_commit" ] && [ "${RESTORE_ALLOW_VERSION_MISMATCH:-}" != "YES" ]; then
  echo "El backup corresponde al commit $backup_commit. Cambia a esa versión o confirma RESTORE_ALLOW_VERSION_MISMATCH=YES." >&2
  exit 1
fi

DEPLOY_TARGET=$backup_target
export DEPLOY_TARGET
scripts/compose.sh --profile bundled-n8n stop gateway api web ai-cfo keycloak firefly n8n redis || true
scripts/compose.sh up -d --wait postgres
gzip -dc "$backup_dir/postgres.sql.gz" | scripts/compose.sh exec -T postgres psql -v ON_ERROR_STOP=1 -U finanzas -d postgres

restore_volume() {
  archive=$1
  volume_name=$2
  if [ -f "$backup_dir/$archive" ]; then
    docker volume create "$volume_name" >/dev/null
    docker run --rm \
      -v "$volume_name":/data \
      -v "$backup_dir":/backup:ro \
      alpine:3.22 sh -ec "find /data -mindepth 1 -delete; tar -C /data -xzf /backup/$archive"
  fi
}

restore_volume firefly-upload.tar.gz "${current_project}_firefly_upload"
restore_volume redis-data.tar.gz "${current_project}_redis_data"
restore_volume n8n-data.tar.gz "${current_project}_n8n_data"
restore_volume caddy-data.tar.gz "${current_project}_caddy_data"
restore_volume caddy-config.tar.gz "${current_project}_caddy_config"

if [ "${RESTORE_ENV:-}" = "YES" ]; then
  cp "$backup_dir/env.secrets" .env
  chmod 600 .env
  echo ".env restaurado desde el backup porque RESTORE_ENV=YES."
fi
rm -rf runtime/keycloak
cp -R "$backup_dir/runtime/keycloak" runtime/

node scripts/configure-domain.mjs
node scripts/preflight.mjs
scripts/deploy.sh
echo "Restauración completada. Ejecuta las pruebas de aceptación antes de habilitar escrituras reales."
