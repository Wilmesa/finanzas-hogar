#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

env_target=""
env_auth=""
env_bundled_n8n=""
if [ -f .env ]; then
  env_target=$(sed -n 's/^DEPLOY_TARGET=//p' .env | tail -n 1)
  env_auth=$(sed -n 's/^AUTH_MODE=//p' .env | tail -n 1)
  env_bundled_n8n=$(sed -n 's/^ENABLE_BUNDLED_N8N=//p' .env | tail -n 1)
fi
deploy_target=${DEPLOY_TARGET:-${env_target:-private}}
default_auth=local
[ "$deploy_target" = "public" ] && default_auth=keycloak
auth_mode=${AUTH_MODE:-${env_auth:-$default_auth}}
enable_bundled_n8n=${ENABLE_BUNDLED_N8N:-${env_bundled_n8n:-false}}

case "$deploy_target:$auth_mode:$enable_bundled_n8n" in
  private:local:false)
    set -- -f docker-compose.yml -f docker-compose.private.yml "$@"
    ;;
  private:keycloak:false)
    set -- -f docker-compose.yml -f docker-compose.private.yml -f docker-compose.keycloak.yml "$@"
    ;;
  public:local:false)
    set -- -f docker-compose.yml -f docker-compose.public.yml "$@"
    ;;
  public:keycloak:false)
    set -- -f docker-compose.yml -f docker-compose.public.yml -f docker-compose.keycloak.yml "$@"
    ;;
  private:local:true)
    set -- -f docker-compose.yml -f docker-compose.private.yml -f docker-compose.n8n.yml "$@"
    ;;
  private:keycloak:true)
    set -- -f docker-compose.yml -f docker-compose.private.yml -f docker-compose.keycloak.yml -f docker-compose.n8n.yml "$@"
    ;;
  public:local:true)
    set -- -f docker-compose.yml -f docker-compose.public.yml -f docker-compose.n8n.yml "$@"
    ;;
  public:keycloak:true)
    set -- -f docker-compose.yml -f docker-compose.public.yml -f docker-compose.keycloak.yml -f docker-compose.n8n.yml "$@"
    ;;
  *)
    echo "DEPLOY_TARGET/AUTH_MODE/ENABLE_BUNDLED_N8N inválidos: $deploy_target/$auth_mode/$enable_bundled_n8n" >&2
    exit 2
    ;;
esac

if docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi
if command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose "$@"
fi
echo "Docker Compose no está instalado o no es accesible" >&2
exit 127
