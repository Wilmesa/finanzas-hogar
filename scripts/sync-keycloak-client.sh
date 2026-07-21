#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

scripts/compose.sh exec -T keycloak /bin/bash -ec '
  config=/tmp/kcadm-finanzas.config
  trap "rm -f $config" EXIT
  /opt/keycloak/bin/kcadm.sh config credentials \
    --config "$config" \
    --server http://127.0.0.1:8080/auth \
    --realm master \
    --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
    --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null
  client_id=$(/opt/keycloak/bin/kcadm.sh get clients \
    --config "$config" \
    -r finanzas \
    -q clientId=finanzas-web \
    --fields id \
    --format csv \
    --noquotes | head -n 1)
  if [ -z "$client_id" ]; then
    echo "No se encontró el cliente finanzas-web" >&2
    exit 1
  fi
  /opt/keycloak/bin/kcadm.sh update "clients/$client_id" \
    --config "$config" \
    -r finanzas \
    -s "redirectUris=[\"$APP_ORIGIN/*\"]" \
    -s "webOrigins=[\"$APP_ORIGIN\"]" >/dev/null
'

echo "Cliente OIDC sincronizado con APP_ORIGIN."
