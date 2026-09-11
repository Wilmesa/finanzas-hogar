#!/usr/bin/env sh
set -eu
# Caller pauses all writers. Each pg_dump is checked before continuing; do not
# pipe into gzip, which can hide a failed pg_dump in POSIX sh.
test "$#" -eq 1
destination=$1
mkdir -p "$destination"
chmod 700 "$destination"
for database in finanzas firefly keycloak n8n; do
  scripts/compose.sh exec -T postgres pg_dump -U finanzas -Fc --create "$database" > "$destination/$database.dump"
  test -s "$destination/$database.dump"
  chmod 600 "$destination/$database.dump"
done
