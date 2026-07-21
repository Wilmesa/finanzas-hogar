#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$project_dir/backups/$timestamp"
mkdir -p "$backup_dir"

docker compose exec -T postgres pg_dumpall -U finanzas | gzip > "$backup_dir/postgres.sql.gz"
docker run --rm \
  -v finanzas-pareja_firefly_upload:/data:ro \
  -v "$backup_dir":/backup \
  alpine:3.22 tar -C /data -czf /backup/firefly-upload.tar.gz .
docker run --rm \
  -v finanzas-pareja_n8n_data:/data:ro \
  -v "$backup_dir":/backup \
  alpine:3.22 tar -C /data -czf /backup/n8n-data.tar.gz .

cp docker-compose.yml "$backup_dir/docker-compose.yml"
cp infra/keycloak/finanzas-realm.json "$backup_dir/finanzas-realm.json"
(cd "$backup_dir" && sha256sum ./* > SHA256SUMS)
echo "Backup creado en $backup_dir"
echo "Cópialo cifrado fuera del servidor y prueba una restauración aislada. .env no fue incluido."
