#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

base="docker compose -f docker-compose.yml -f docker-compose.private.yml"
admin="$base -f docker-compose.firefly-admin.yml"

case "${1:-status}" in
  start)
    # Solo publica el puerto administrativo en loopback y conserva el volumen.
    $admin up -d --no-deps firefly
    echo "Firefly administrativo disponible en http://127.0.0.1:${FIREFLY_LOCAL_PORT:-8081}"
    ;;
  stop)
    # Recrea el servicio sin el override de puerto; nunca elimina el volumen.
    $base up -d --no-deps --force-recreate firefly
    echo "Puerto administrativo de Firefly retirado. Los datos permanecen intactos."
    ;;
  status)
    $admin ps firefly
    echo "El acceso, cuando está activo, queda limitado a 127.0.0.1:${FIREFLY_LOCAL_PORT:-8081}."
    ;;
  *)
    echo "Uso: scripts/firefly-admin.sh start|stop|status" >&2
    exit 2
    ;;
esac
