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

docker compose stop api web ai-cfo n8n keycloak firefly
gzip -dc "$backup_dir/postgres.sql.gz" | docker compose exec -T postgres psql -U finanzas -d postgres
docker run --rm \
  -v finanzas-pareja_firefly_upload:/data \
  -v "$backup_dir":/backup:ro \
  alpine:3.22 sh -c 'find /data -mindepth 1 -delete && tar -C /data -xzf /backup/firefly-upload.tar.gz'
docker run --rm \
  -v finanzas-pareja_n8n_data:/data \
  -v "$backup_dir":/backup:ro \
  alpine:3.22 sh -c 'find /data -mindepth 1 -delete && tar -C /data -xzf /backup/n8n-data.tar.gz'
docker compose up -d
echo "Restauración terminada. Verifica health checks y conciliación antes de habilitar escrituras."
