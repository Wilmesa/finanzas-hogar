import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isUnsafeSecret,
  normalizeAppOrigin,
  readEnv,
  SECRET_KEYS,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  BUNDLED_N8N_SECRET_KEYS,
} from "./lib/config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localMode = process.argv.includes("--local");
const bootstrap = process.argv.includes("--bootstrap");
const skipDocker = process.argv.includes("--skip-docker");
const errors = [];
const warnings = [];

function command(command, args) {
  return spawnSync(command, args, { cwd: root, encoding: "utf8" });
}

if (localMode) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22)
    errors.push("El modo local requiere Node.js 22 o posterior");
  const pnpm = command("pnpm", ["--version"]);
  if (pnpm.status !== 0)
    errors.push("pnpm no está instalado o no es accesible");
} else {
  const envPath = resolve(root, ".env");
  let env = {};
  try {
    env = readEnv(envPath);
  } catch {
    errors.push("Falta .env. Ejecuta node scripts/init-env.mjs");
  }

  if (existsSync(envPath) && (statSync(envPath).mode & 0o077) !== 0) {
    errors.push(".env debe tener permisos 0600: ejecuta chmod 600 .env");
  }

  const target = process.env.DEPLOY_TARGET || env.DEPLOY_TARGET;
  if (!["private", "public"].includes(target))
    errors.push("DEPLOY_TARGET debe ser private o public");
  const auth =
    process.env.AUTH_MODE ||
    env.AUTH_MODE ||
    (target === "public" ? "keycloak" : "local");
  const bundledN8n =
    (process.env.ENABLE_BUNDLED_N8N || env.ENABLE_BUNDLED_N8N || "false") ===
    "true";
  if (
    !["true", "false"].includes(
      process.env.ENABLE_BUNDLED_N8N || env.ENABLE_BUNDLED_N8N || "false",
    )
  )
    errors.push("ENABLE_BUNDLED_N8N debe ser true o false");
  if (!["local", "keycloak"].includes(auth))
    errors.push("AUTH_MODE debe ser local o keycloak");
  if ((process.env.PUBLIC_AUTH_MODE || env.PUBLIC_AUTH_MODE || auth) !== auth)
    errors.push("PUBLIC_AUTH_MODE debe coincidir con AUTH_MODE");
  if (!/^[a-z0-9][a-z0-9_-]{2,62}$/i.test(env.COMPOSE_PROJECT_NAME ?? ""))
    errors.push("COMPOSE_PROJECT_NAME no es válido");

  let origin = "";
  try {
    origin = normalizeAppOrigin(env.APP_ORIGIN ?? "");
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause));
  }

  if (target === "private") {
    const port = Number(env.APP_LOCAL_PORT);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      errors.push("APP_LOCAL_PORT debe estar entre 1024 y 65535");
  }
  if (env.DEV_AUTH_ENABLED !== "false")
    errors.push("DEV_AUTH_ENABLED debe ser false en despliegues integrados");

  for (const key of SECRET_KEYS) {
    if (key === "KEYCLOAK_ADMIN_PASSWORD" && auth !== "keycloak") continue;
    const value = process.env[key] ?? env[key] ?? "";
    if (isUnsafeSecret(value)) errors.push(`${key} no es un secreto válido`);
  }
  if (bundledN8n) {
    for (const key of BUNDLED_N8N_SECRET_KEYS) {
      const value = process.env[key] ?? env[key] ?? "";
      if (isUnsafeSecret(value)) errors.push(`${key} no es un secreto válido`);
    }
  }
  if (!isValidVapidPublicKey(env.VAPID_PUBLIC_KEY))
    errors.push("VAPID_PUBLIC_KEY no es una clave pública VAPID válida");
  if (!isValidVapidPrivateKey(env.VAPID_PRIVATE_KEY))
    errors.push("VAPID_PRIVATE_KEY no es una clave privada VAPID válida");

  const aiProvider = (
    process.env.AI_PROVIDER ||
    env.AI_PROVIDER ||
    "disabled"
  ).toLowerCase();
  if (
    ![
      "disabled",
      "openai",
      "gemini",
      "openai_compatible",
      "deterministic",
    ].includes(aiProvider)
  ) {
    errors.push(
      "AI_PROVIDER debe ser disabled, openai, gemini, openai_compatible o deterministic",
    );
  }
  if (
    aiProvider === "openai" &&
    !(process.env.OPENAI_API_KEY || env.OPENAI_API_KEY)
  ) {
    errors.push("OPENAI_API_KEY es obligatoria cuando AI_PROVIDER=openai");
  }
  if (
    aiProvider === "gemini" &&
    !(process.env.GEMINI_API_KEY || env.GEMINI_API_KEY)
  ) {
    errors.push("GEMINI_API_KEY es obligatoria cuando AI_PROVIDER=gemini");
  }
  if (aiProvider === "openai_compatible") {
    for (const key of [
      "AI_COMPATIBLE_BASE_URL",
      "AI_COMPATIBLE_API_KEY",
      "AI_COMPATIBLE_MODEL",
    ]) {
      if (!(process.env[key] || env[key]))
        errors.push(
          `${key} es obligatoria cuando AI_PROVIDER=openai_compatible`,
        );
    }
  }

  for (const key of [
    "FIREFLY_HOUSEHOLD_TOKEN",
    "FIREFLY_PRIVATE_TOKEN_MEMBER_A",
    "FIREFLY_PRIVATE_TOKEN_MEMBER_B",
  ]) {
    if (!env[key]) {
      if (bootstrap) warnings.push(`${key} pendiente durante bootstrap`);
      else errors.push(`Falta ${key}`);
    }
  }

  if (
    ["member-a", "member-b"].includes(env.MEMBER_A_ID) ||
    ["member-a", "member-b"].includes(env.MEMBER_B_ID)
  ) {
    warnings.push("Los MEMBER_*_ID todavía parecen valores de bootstrap");
  }

  const realmPath = resolve(root, "runtime/keycloak/finanzas-realm.json");
  if (auth === "keycloak" && !existsSync(realmPath)) {
    errors.push(
      "Falta el realm runtime; ejecuta node scripts/configure-domain.mjs",
    );
  } else if (auth === "keycloak" && origin) {
    const realm = JSON.parse(readFileSync(realmPath, "utf8"));
    const client = realm.clients?.find(
      (item) => item.clientId === "finanzas-web",
    );
    if (
      !client ||
      client.webOrigins?.length !== 1 ||
      client.webOrigins[0] !== origin ||
      client.redirectUris?.[0] !== `${origin}/*`
    ) {
      errors.push("El realm runtime no coincide con APP_ORIGIN");
    }
  }

  if (!skipDocker) {
    const docker = command("docker", ["--version"]);
    if (docker.status !== 0)
      errors.push("Docker no está instalado o no es accesible");
    const compose = command("docker", ["compose", "version"]);
    if (compose.status !== 0)
      errors.push("El plugin docker compose no está disponible");
    if (docker.status === 0 && compose.status === 0) {
      const rendered = command("scripts/compose.sh", [
        "config",
        "--format",
        "json",
      ]);
      if (rendered.status !== 0) {
        errors.push(`Compose inválido: ${rendered.stderr.trim()}`);
      } else {
        try {
          const config = JSON.parse(rendered.stdout);
          const services = config.services ?? {};
          if (auth === "local" && services.keycloak)
            errors.push("AUTH_MODE=local no debe incluir Keycloak");
          if (auth === "keycloak" && !services.keycloak)
            errors.push("AUTH_MODE=keycloak debe incluir Keycloak");
          if (bundledN8n !== Boolean(services.n8n))
            errors.push(
              "La presencia de n8n no coincide con ENABLE_BUNDLED_N8N",
            );
          if (target === "private") {
            const gatewayPorts = services.gateway?.ports ?? [];
            if (
              gatewayPorts.length !== 1 ||
              gatewayPorts[0].host_ip !== "127.0.0.1" ||
              Number(gatewayPorts[0].published) !== Number(env.APP_LOCAL_PORT)
            ) {
              errors.push(
                "El gateway privado no publica exclusivamente APP_LOCAL_PORT en 127.0.0.1",
              );
            }
            for (const [name, service] of Object.entries(services)) {
              if (name !== "gateway" && (service.ports?.length ?? 0) > 0)
                errors.push(`${name} publica puertos en el target privado`);
            }
          }
        } catch (cause) {
          errors.push(`No se pudo analizar docker compose config: ${cause}`);
        }
      }
    }
  }
}

for (const warning of warnings) console.warn(`ADVERTENCIA: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`Preflight falló con ${errors.length} error(es).`);
  process.exit(1);
}
console.log(
  localMode ? "Preflight local correcto." : "Preflight de despliegue correcto.",
);
