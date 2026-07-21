#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

env_target=""
if [ -f .env ]; then
  env_target=$(sed -n 's/^DEPLOY_TARGET=//p' .env | tail -n 1)
fi
deploy_target=${DEPLOY_TARGET:-${env_target:-private}}

case "$deploy_target" in
  private)
    set -- -f docker-compose.yml -f docker-compose.private.yml "$@"
    ;;
  public)
    set -- -f docker-compose.yml -f docker-compose.public.yml "$@"
    ;;
  *)
    echo "DEPLOY_TARGET debe ser private o public; recibido: $deploy_target" >&2
    exit 2
    ;;
esac

exec docker compose "$@"
