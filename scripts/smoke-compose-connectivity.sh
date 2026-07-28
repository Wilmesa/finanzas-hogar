#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

echo "API -> PostgreSQL"
scripts/compose.sh exec -T -w /app/apps/api api node --input-type=module -e '
  import { PrismaClient } from "@prisma/client";
  const prisma = new PrismaClient();
  const result = await prisma.$queryRawUnsafe("SELECT 1 AS ok");
  await prisma.$disconnect();
  if (Number(result[0]?.ok) !== 1) process.exit(1);
'

echo "API -> Redis"
scripts/compose.sh exec -T -w /app/apps/api api node --input-type=module -e '
  import { createClient } from "redis";
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  const pong = await client.ping();
  await client.quit();
  if (pong !== "PONG") process.exit(1);
'

echo "API -> Firefly"
scripts/compose.sh exec -T api node --input-type=module -e '
  const response = await fetch(`${process.env.FIREFLY_BASE_URL}/health`);
  if (!response.ok) process.exit(1);
'

echo "API -> AI-CFO"
scripts/compose.sh exec -T api node --input-type=module -e '
  const response = await fetch(`${process.env.AI_CFO_URL}/health`, {
    headers: { "x-internal-token": process.env.AI_CFO_INTERNAL_TOKEN },
  });
  if (!response.ok) process.exit(1);
'

echo "Firefly -> API (ruta usada por webhooks)"
scripts/compose.sh exec -T firefly \
  curl -fsS http://api:3000/health >/dev/null

echo "Gateway -> API/PWA"
scripts/compose.sh exec -T gateway \
  wget -q --spider http://127.0.0.1/healthz
scripts/compose.sh exec -T gateway \
  wget -q --spider http://api:3000/health
scripts/compose.sh exec -T gateway \
  wget -q --spider http://web:3000/

echo "Conectividad PostgreSQL, Redis, Firefly, API, PWA y gateway: correcta."
