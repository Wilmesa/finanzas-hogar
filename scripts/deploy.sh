#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

bootstrap_flag=""
if [ "${1:-}" = "--bootstrap" ]; then
  bootstrap_flag="--bootstrap"
fi

node scripts/configure-domain.mjs
node scripts/preflight.mjs $bootstrap_flag
scripts/compose.sh config --quiet

echo "Descargando imágenes fijadas y construyendo servicios propios..."
scripts/compose.sh pull --ignore-buildable
scripts/compose.sh build --pull web api ai-cfo

echo "Iniciando datos, identidad, contabilidad e IA..."
scripts/compose.sh up -d --wait --wait-timeout "${HEALTHCHECK_TIMEOUT:-300}" \
  postgres redis ai-cfo keycloak firefly

echo "Aplicando migraciones Prisma antes de iniciar la API..."
scripts/compose.sh run --rm --no-deps api \
  pnpm --filter @finanzas/api exec prisma migrate deploy

scripts/sync-keycloak-client.sh

echo "Iniciando API, PWA y gateway del target ${DEPLOY_TARGET:-configurado en .env}..."
scripts/compose.sh up -d --wait --wait-timeout "${HEALTHCHECK_TIMEOUT:-300}" \
  api web gateway
scripts/compose.sh ps

echo "n8n integrado no fue iniciado. Diagnóstico: scripts/compose.sh logs --tail=100 gateway api web keycloak firefly ai-cfo"
