#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if [ ! -d .git ]; then
  echo "Este directorio no es un clon Git." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Hay cambios locales. La actualización fue cancelada." >&2
  exit 1
fi

env_target=$(sed -n 's/^DEPLOY_TARGET=//p' .env | tail -n 1)
deploy_target=${DEPLOY_TARGET:-${env_target:-}}
case "$deploy_target" in private|public) ;; *) echo "DEPLOY_TARGET inválido" >&2; exit 2 ;; esac
export DEPLOY_TARGET="$deploy_target"
env_auth=$(sed -n 's/^AUTH_MODE=//p' .env | tail -n 1)
auth_mode=${AUTH_MODE:-${env_auth:-local}}
case "$auth_mode" in local|keycloak) ;; *) echo "AUTH_MODE inválido" >&2; exit 2 ;; esac
export AUTH_MODE="$auth_mode"
env_bundled_n8n=$(sed -n 's/^ENABLE_BUNDLED_N8N=//p' .env | tail -n 1)
enable_bundled_n8n=${ENABLE_BUNDLED_N8N:-${env_bundled_n8n:-false}}
case "$enable_bundled_n8n" in true|false) ;; *) echo "ENABLE_BUNDLED_N8N inválido" >&2; exit 2 ;; esac
export ENABLE_BUNDLED_N8N="$enable_bundled_n8n"

previous_commit=$(git rev-parse HEAD)
echo "Creando respaldo antes de actualizar $previous_commit..."
scripts/backup.sh
backup_path=$(cat runtime/deploy/last-backup)

git pull --ff-only
new_commit=$(git rev-parse HEAD)
node scripts/configure-domain.mjs
node scripts/preflight.mjs
scripts/deploy.sh

mkdir -p runtime/deploy
{
  echo "PREVIOUS_COMMIT=$previous_commit"
  echo "DEPLOYED_COMMIT=$new_commit"
  echo "DEPLOY_TARGET=$deploy_target"
  echo "AUTH_MODE=$auth_mode"
  echo "ENABLE_BUNDLED_N8N=$enable_bundled_n8n"
  echo "BACKUP_PATH=$backup_path"
} > runtime/deploy/last-update.env
chmod 600 runtime/deploy/last-update.env

echo "Actualización completada: $previous_commit -> $new_commit"
echo "Rollback manual: consulta runtime/deploy/last-update.env y docs/DEPLOY_PRIVATE_TAILSCALE.md."
