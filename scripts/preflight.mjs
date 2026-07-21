import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const allowLocal = process.argv.includes("--local");
const errors = [];
const warnings = [];

function envFile() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) {
    errors.push("Falta .env. Ejecuta node scripts/init-env.mjs");
    return {};
  }
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const env = envFile();
const secretKeys = [
  "POSTGRES_PASSWORD",
  "KEYCLOAK_ADMIN_PASSWORD",
  "FIREFLY_APP_KEY",
  "AI_CFO_INTERNAL_TOKEN",
  "N8N_AUTOMATION_TOKEN",
  "N8N_ENCRYPTION_KEY",
];
for (const key of secretKeys) {
  const value = env[key] ?? "";
  if (value.length < 24 || /change-me|replace-with/i.test(value)) {
    errors.push(`${key} no es un secreto de producción válido`);
  }
}
if (!allowLocal) {
  if (!env.APP_DOMAIN || env.APP_DOMAIN === "localhost")
    errors.push("APP_DOMAIN sigue en localhost");
  for (const key of [
    "FIREFLY_HOUSEHOLD_TOKEN",
    "FIREFLY_PRIVATE_TOKEN_MEMBER_A",
    "FIREFLY_PRIVATE_TOKEN_MEMBER_B",
  ]) {
    if (!env[key]) errors.push(`Falta ${key}`);
  }
  if (
    ["member-a", "member-b"].includes(env.MEMBER_A_ID) ||
    ["member-a", "member-b"].includes(env.MEMBER_B_ID)
  ) {
    warnings.push(
      "Los MEMBER_*_ID parecen valores demo; deben coincidir con sub de Keycloak",
    );
  }
  const realm = readFileSync(
    resolve(root, "infra/keycloak/finanzas-realm.json"),
    "utf8",
  );
  if (env.APP_DOMAIN && !realm.includes(`https://${env.APP_DOMAIN}`)) {
    errors.push(
      "El realm de Keycloak no contiene APP_DOMAIN; ejecuta configure-domain.mjs",
    );
  }
}

const docker = spawnSync("docker", ["--version"], { encoding: "utf8" });
if (docker.status !== 0)
  errors.push("Docker no está instalado o no es accesible");
const compose = spawnSync("docker", ["compose", "version"], {
  encoding: "utf8",
});
if (compose.status !== 0)
  errors.push("El plugin docker compose no está disponible");

for (const warning of warnings) console.warn(`ADVERTENCIA: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`Preflight falló con ${errors.length} error(es).`);
  process.exit(1);
}
console.log(
  "Preflight correcto. El host está listo para construir los contenedores.",
);
