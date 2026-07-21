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
  echo "BACKUP_PATH=$backup_path"
} > runtime/deploy/last-update.env
chmod 600 runtime/deploy/last-update.env

echo "Actualización completada: $previous_commit -> $new_commit"
echo "Rollback manual: consulta runtime/deploy/last-update.env y docs/DEPLOY_PRIVATE_TAILSCALE.md."
