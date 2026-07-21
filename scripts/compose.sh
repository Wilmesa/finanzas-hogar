#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

env_target=""
env_auth=""
if [ -f .env ]; then
  env_target=$(sed -n 's/^DEPLOY_TARGET=//p' .env | tail -n 1)
  env_auth=$(sed -n 's/^AUTH_MODE=//p' .env | tail -n 1)
fi
deploy_target=${DEPLOY_TARGET:-${env_target:-private}}
default_auth=local
[ "$deploy_target" = "public" ] && default_auth=keycloak
auth_mode=${AUTH_MODE:-${env_auth:-$default_auth}}

case "$deploy_target:$auth_mode" in
  private:local)
    set -- -f docker-compose.yml -f docker-compose.private.yml "$@"
    ;;
  private:keycloak)
    set -- -f docker-compose.yml -f docker-compose.private.yml -f docker-compose.keycloak.yml "$@"
    ;;
  public:local)
    set -- -f docker-compose.yml -f docker-compose.public.yml "$@"
    ;;
  public:keycloak)
    set -- -f docker-compose.yml -f docker-compose.public.yml -f docker-compose.keycloak.yml "$@"
    ;;
  *)
    echo "DEPLOY_TARGET/AUTH_MODE inválidos: $deploy_target/$auth_mode" >&2
    exit 2
    ;;
esac

exec docker compose "$@"
