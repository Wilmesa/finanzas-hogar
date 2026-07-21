#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

node scripts/preflight.mjs
docker compose pull
docker compose build --pull
docker compose up -d postgres redis keycloak firefly
docker compose up -d api ai-cfo web n8n caddy
docker compose ps

echo "Despliegue solicitado. Revisa: docker compose logs --tail=100 api web firefly keycloak"

