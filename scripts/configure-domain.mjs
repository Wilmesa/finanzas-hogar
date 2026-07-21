import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv, renderRealm } from "./lib/config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = readEnv(resolve(root, ".env"));
const selectedAuth =
  process.env.AUTH_MODE ??
  env.AUTH_MODE ??
  ((process.env.DEPLOY_TARGET ?? env.DEPLOY_TARGET) === "public"
    ? "keycloak"
    : "local");
if (selectedAuth !== "keycloak") {
  console.log("AUTH_MODE=local: no se genera configuración de Keycloak.");
  process.exit(0);
}
const templatePath = resolve(
  root,
  "infra/keycloak/finanzas-realm.template.json",
);
const outputPath = resolve(root, "runtime/keycloak/finanzas-realm.json");
const template = JSON.parse(readFileSync(templatePath, "utf8"));
const realm = renderRealm(
  template,
  process.env.APP_ORIGIN ?? env.APP_ORIGIN ?? "",
);
const next = `${JSON.stringify(realm, null, 2)}\n`;

mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
let current = "";
try {
  current = readFileSync(outputPath, "utf8");
} catch {
  // El archivo runtime todavía no existe.
}
if (current !== next) {
  writeFileSync(outputPath, next, { mode: 0o600 });
  console.log(`Realm runtime generado para ${env.APP_ORIGIN}`);
} else {
  console.log(`Realm runtime ya estaba actualizado para ${env.APP_ORIGIN}`);
}
