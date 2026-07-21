#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if [ ! -d .git ]; then
  echo "Este directorio no es un clon Git. Clona el repositorio antes de actualizar." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Hay cambios locales. No se actualizará para evitar sobrescribirlos." >&2
  exit 1
fi

echo "Creando respaldo previo a la actualización..."
scripts/backup.sh
git pull --ff-only
node scripts/preflight.mjs
docker compose pull
docker compose build --pull
docker compose up -d
docker compose ps

echo "Actualización aplicada. Revisa logs y ejecuta la lista de aceptación de docs/MIGRATION.md."
