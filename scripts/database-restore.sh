#!/usr/bin/env sh
set -eu
test "$#" -eq 1
if [ "${RESTORE_CONFIRM:-}" != "SI_RESTAURAR" ]; then
  echo "Restauración cancelada: falta RESTORE_CONFIRM=SI_RESTAURAR" >&2
  exit 2
fi
source_dir=$1
# Validate all four archives before dropping any database. Unlike pg_dumpall
# this does not attempt to drop the currently connected PostgreSQL role.
for database in finanzas firefly keycloak n8n; do
  test -s "$source_dir/$database.dump"
  scripts/compose.sh exec -T postgres pg_restore --list < "$source_dir/$database.dump" > /dev/null
done
for database in finanzas firefly keycloak n8n; do
  scripts/compose.sh exec -T postgres pg_restore --exit-on-error --clean --if-exists --create --no-owner -U finanzas -d postgres < "$source_dir/$database.dump"
done
