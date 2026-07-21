import { existsSync, readFileSync } from "node:fs";

export const SECRET_KEYS = [
  "POSTGRES_PASSWORD",
  "KEYCLOAK_ADMIN_PASSWORD",
  "FIREFLY_APP_KEY",
  "AI_CFO_INTERNAL_TOKEN",
  "VAPID_PRIVATE_KEY",
];

export const BUNDLED_N8N_SECRET_KEYS = [
  "N8N_AUTOMATION_TOKEN",
  "N8N_ENCRYPTION_KEY",
];

export function isValidVapidPublicKey(value) {
  return /^[A-Za-z0-9_-]{87}$/.test(value ?? "");
}

export function isValidVapidPrivateKey(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(value ?? "");
}

export function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

export function readEnv(path) {
  if (!existsSync(path)) throw new Error(`Falta ${path}`);
  return parseEnv(readFileSync(path, "utf8"));
}

export function normalizeAppOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN debe ser una URL HTTPS completa");
  }
  if (url.protocol !== "https:")
    throw new Error("APP_ORIGIN debe usar https://");
  if (!url.hostname) throw new Error("APP_ORIGIN debe contener un hostname");
  if (url.username || url.password)
    throw new Error("APP_ORIGIN no puede contener credenciales");
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error(
      "APP_ORIGIN no puede contener rutas, parámetros ni fragmentos",
    );
  return url.origin;
}

export function isUnsafeSecret(value) {
  return (
    value.length < 24 ||
    /change[-_]?me|replace[-_]?with|generate[-_]?me|example[-_]?secret|local[-_].*token/i.test(
      value,
    )
  );
}

export function renderRealm(template, appOrigin) {
  const origin = normalizeAppOrigin(appOrigin);
  const realm = structuredClone(template);
  const webClient = realm.clients?.find(
    (client) => client.clientId === "finanzas-web",
  );
  if (!webClient) throw new Error("La plantilla no contiene finanzas-web");
  webClient.redirectUris = [`${origin}/*`];
  webClient.webOrigins = [origin];
  return realm;
}
