#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if ! docker compose version >/dev/null 2>&1 &&
  ! docker-compose version >/dev/null 2>&1; then
  echo "Docker Compose no está disponible; smoke test no ejecutado." >&2
  exit 2
fi

export DEPLOY_TARGET=private AUTH_MODE=local PUBLIC_AUTH_MODE=local
export ENABLE_BUNDLED_N8N=false
export COMPOSE_PROJECT_NAME="finanzas-smoke-${GITHUB_RUN_ID:-local}"
export APP_ORIGIN=https://smoke.example.invalid APP_LOCAL_PORT=${SMOKE_LOCAL_PORT:-13100}
export POSTGRES_PASSWORD=test-only-postgres-password-123456
export FIREFLY_APP_KEY="base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
export AI_CFO_INTERNAL_TOKEN=test-only-ai-cfo-token-123456789
export AI_PROVIDER=deterministic
export VAPID_PUBLIC_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
export VAPID_PRIVATE_KEY=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
export DEV_AUTH_ENABLED=false HOUSEHOLD_ID=smoke-household HOUSEHOLD_NAME="Smoke household"
export MEMBER_A_ID=smoke-member-a MEMBER_A_NAME="Smoke A" MEMBER_A_EMAIL=a@smoke.invalid MEMBER_A_USERNAME=smoke-a
export MEMBER_B_ID=smoke-member-b MEMBER_B_NAME="Smoke B" MEMBER_B_EMAIL=b@smoke.invalid MEMBER_B_USERNAME=smoke-b
export MEMBER_A_BOOTSTRAP_PASSWORD=Smoke-Only-Password-A-123
export MEMBER_B_BOOTSTRAP_PASSWORD=Smoke-Only-Password-B-456

mkdir -p "$project_dir/secrets"
# Colima shares the workspace but not macOS /var/folders. Keep ephemeral
# bind-mounted secrets inside the ignored secrets directory on both CI/macOS.
work_dir=$(mktemp -d "$project_dir/secrets/smoke.XXXXXX")
export PRIVATE_METADATA_KEYRING_HOST_FILE="$work_dir/keyring.json"
node -e 'const fs=require("node:fs"),crypto=require("node:crypto");fs.writeFileSync(process.env.PRIVATE_METADATA_KEYRING_HOST_FILE,JSON.stringify({activeKeyId:"smoke",keys:{smoke:crypto.randomBytes(32).toString("base64")}}),{mode:0o600})'
show_logs() { scripts/compose.sh logs --no-color --tail=200 api gateway postgres redis firefly ai-cfo 2>/dev/null || true; }
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then show_logs; fi
  scripts/compose.sh down --volumes --remove-orphans >/dev/null 2>&1 || true
  find "$work_dir" -type f -delete
  find "$work_dir" -depth -type d -empty -delete
  exit "$status"
}
trap cleanup EXIT INT TERM

if [ "${SMOKE_SKIP_BUILD:-false}" != "true" ]; then
  scripts/compose.sh build web api ai-cfo
fi
scripts/compose.sh up -d --wait --wait-timeout 360 postgres redis ai-cfo firefly
scripts/compose.sh exec -T -e APP_ENV=testing firefly php < scripts/tests/bootstrap-firefly-smoke.php > "$work_dir/firefly-bootstrap"
FIREFLY_HOUSEHOLD_TOKEN=$(sed -n 's/^OKLE_SMOKE_TOKEN=\([A-Za-z0-9._-]*\)$/\1/p' "$work_dir/firefly-bootstrap")
export FIREFLY_HOUSEHOLD_TOKEN
test -n "$FIREFLY_HOUSEHOLD_TOKEN"
scripts/compose.sh run --rm --no-deps api pnpm --filter @finanzas/api exec prisma migrate deploy
scripts/bootstrap-local-users.sh
scripts/compose.sh up -d --wait --wait-timeout 180 api web gateway
node scripts/smoke-financial-flow.mjs

# Exercise actual PostgreSQL backup/restore only in the disposable project.
before_restore=$(scripts/compose.sh exec -T postgres psql -U finanzas -d finanzas -Atc 'SELECT count(*) FROM "TransactionAttribution"')
scripts/compose.sh stop api firefly
sh scripts/database-backup.sh "$work_dir/databases"
RESTORE_CONFIRM=SI_RESTAURAR sh scripts/database-restore.sh "$work_dir/databases"
after_restore=$(scripts/compose.sh exec -T postgres psql -U finanzas -d finanzas -Atc 'SELECT count(*) FROM "TransactionAttribution"')
test "$before_restore" = "$after_restore"
scripts/compose.sh up -d --wait --wait-timeout 180 api firefly
echo "Backup/restauración PostgreSQL correcto: cuatro bases, movimientos conservados."

base="http://127.0.0.1:${APP_LOCAL_PORT}"
curl -fsS -D "$work_dir/headers" -o "$work_dir/login.json" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"smoke-a","password":"Smoke-Only-Password-A-123"}' \
  "$base/api/v1/auth/login"
cookie=$(sed -n 's/^set-cookie: \([^;]*\).*/\1/ip' "$work_dir/headers" | head -n 1)
csrf=$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).csrfToken)' "$work_dir/login.json")
test -n "$cookie" && test -n "$csrf"
curl -fsS -H "Cookie: $cookie" "$base/api/v1/auth/me" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(x.householdMemberId!=="smoke-member-a")process.exit(1)})'
curl -fsS -H "Cookie: $cookie" "$base/api/v1/pockets" >/dev/null
curl -fsS -X POST -H "Cookie: $cookie" -H "X-CSRF-Token: $csrf" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mercado smoke","purpose":"daily_spend","visibility":"household","currency":"COP","currentAmount":"0","rolloverPolicy":"carry_balance","policy":{"kind":"periodic_spend","limit":"1000000","period":"monthly"}}' \
  "$base/api/v1/pockets" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(x.name!=="Mercado smoke"||x.policy.kind!=="periodic_spend")process.exit(1)})'
curl -fsS -X PATCH -H "Cookie: $cookie" -H "X-CSRF-Token: $csrf" \
  -H 'Content-Type: application/json' -d '{"displayName":"Smoke Owner","color":"#059669"}' \
  "$base/api/v1/profile" >/dev/null
curl -fsS -X POST -H "Cookie: $cookie" -H "X-CSRF-Token: $csrf" \
  -H 'Content-Type: application/json' -d '{"scope":"household"}' \
  "$base/api/v1/insights/generate" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(!x.id||!x.payload.bundle)process.exit(1)})'
curl -fsS -H "Cookie: $cookie" "$base/" | grep -q 'OKLE'
curl -fsS -H "Cookie: $cookie" "$base/manifest.webmanifest" | grep -q 'OKLE'
curl -fsS -X POST -H "Cookie: $cookie" -H "X-CSRF-Token: $csrf" "$base/api/v1/auth/logout" >/dev/null
if curl -fsS -H "Cookie: $cookie" "$base/api/v1/auth/me" >/dev/null 2>&1; then
  echo "La sesión revocada siguió siendo aceptada." >&2
  exit 1
fi

echo "Smoke local correcto: arranque, login, perfil, bolsillo periódico, AI-CFO determinístico, PWA, logout y revocación."
