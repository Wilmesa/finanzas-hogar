import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function readEnv() {
  const path = resolve(root, ".env");
  if (!existsSync(path))
    throw new Error("Falta .env. Ejecuta node scripts/init-env.mjs");
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

const env = readEnv();
const domain = env.APP_DOMAIN;
if (!domain || domain === "localhost" || domain.includes("/")) {
  throw new Error(
    "APP_DOMAIN debe ser un hostname público sin https:// ni rutas",
  );
}
const realmPath = resolve(root, "infra/keycloak/finanzas-realm.json");
const realm = JSON.parse(readFileSync(realmPath, "utf8"));
const webClient = realm.clients.find(
  (client) => client.clientId === "finanzas-web",
);
if (!webClient)
  throw new Error("No existe el cliente finanzas-web en el realm");
webClient.redirectUris = [`https://${domain}/*`];
webClient.webOrigins = [`https://${domain}`];
writeFileSync(realmPath, `${JSON.stringify(realm, null, 2)}\n`);
console.log(`Keycloak configurado para https://${domain}`);
