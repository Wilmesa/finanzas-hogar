import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, ".env");
if (existsSync(destination)) {
  console.error(".env ya existe. No se modificó para evitar perder secretos.");
  process.exit(1);
}

const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");
let content = readFileSync(resolve(root, ".env.example"), "utf8");
const replacements = new Map([
  ["POSTGRES_PASSWORD=change-me", `POSTGRES_PASSWORD=${secret()}`],
  [
    "KEYCLOAK_ADMIN_PASSWORD=change-me-now",
    `KEYCLOAK_ADMIN_PASSWORD=${secret()}`,
  ],
  [
    "FIREFLY_APP_KEY=replace-with-firefly-app-key",
    `FIREFLY_APP_KEY=base64:${randomBytes(32).toString("base64")}`,
  ],
  [
    "AI_CFO_INTERNAL_TOKEN=replace-with-a-long-random-secret",
    `AI_CFO_INTERNAL_TOKEN=${secret()}`,
  ],
  [
    "N8N_AUTOMATION_TOKEN=replace-with-a-different-long-random-secret",
    `N8N_AUTOMATION_TOKEN=${secret()}`,
  ],
  [
    "N8N_ENCRYPTION_KEY=replace-with-a-long-random-encryption-key",
    `N8N_ENCRYPTION_KEY=${secret()}`,
  ],
]);
for (const [from, to] of replacements) content = content.replace(from, to);
writeFileSync(destination, content, { mode: 0o600, flag: "wx" });
console.log(".env creado con secretos aleatorios y permisos 0600.");
console.log(
  "Edita APP_DOMAIN, usuarios, IDs de Keycloak y tokens Firefly antes de producción.",
);
