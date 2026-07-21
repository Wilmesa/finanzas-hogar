import { createECDH, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isUnsafeSecret,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  parseEnv,
  SECRET_KEYS,
} from "./lib/config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");
const example = readFileSync(examplePath, "utf8");
const existed = existsSync(destination);
const current = existed ? readFileSync(destination, "utf8") : "";
const currentValues = parseEnv(current);
const exampleValues = parseEnv(example);
const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");
const generated = [];
const added = [];

function generatedSecret(key) {
  if (key === "FIREFLY_APP_KEY")
    return `base64:${randomBytes(32).toString("base64")}`;
  return secret();
}

const output = current ? current.replace(/\s*$/, "\n") : "";
const lines = output ? output.split(/\r?\n/) : [];

function replaceValue(key, value) {
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

if (
  !isValidVapidPublicKey(currentValues.VAPID_PUBLIC_KEY) ||
  !isValidVapidPrivateKey(currentValues.VAPID_PRIVATE_KEY)
) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  replaceValue("VAPID_PUBLIC_KEY", ecdh.getPublicKey().toString("base64url"));
  replaceValue("VAPID_PRIVATE_KEY", ecdh.getPrivateKey().toString("base64url"));
  currentValues.VAPID_PUBLIC_KEY = "generated";
  currentValues.VAPID_PRIVATE_KEY = "generated";
  generated.push("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY");
}

for (const [key, exampleValue] of Object.entries(exampleValues)) {
  if (key === "VAPID_PUBLIC_KEY" || key === "VAPID_PRIVATE_KEY") continue;
  const existing = currentValues[key];
  if (SECRET_KEYS.includes(key) && (!existing || isUnsafeSecret(existing))) {
    const value = generatedSecret(key);
    replaceValue(key, value);
    generated.push(key);
    continue;
  }
  if (existing === undefined) {
    lines.push(`${key}=${exampleValue}`);
    added.push(key);
  }
}

const resultingValues = parseEnv(lines.join("\n"));
const databaseIndex = lines.findIndex((line) =>
  line.startsWith("DATABASE_URL="),
);
if (
  databaseIndex >= 0 &&
  /GENERATE_ME|change[-_]?me/i.test(lines[databaseIndex] ?? "")
) {
  lines[databaseIndex] =
    `DATABASE_URL=postgresql://finanzas:${resultingValues.POSTGRES_PASSWORD}@postgres:5432/finanzas`;
}

const content = `${lines.filter(Boolean).join("\n")}\n`;
writeFileSync(destination, content, { mode: 0o600 });
chmodSync(destination, 0o600);

console.log(
  existed ? ".env actualizado de forma idempotente." : ".env creado.",
);
if (generated.length)
  console.log(`Secretos generados: ${generated.join(", ")}`);
if (added.length) console.log(`Variables añadidas: ${added.join(", ")}`);
if (!generated.length && !added.length)
  console.log("No fue necesario modificar variables.");
console.log(
  "Los valores secretos no se muestran. Revisa APP_ORIGIN y completa los PAT de Firefly.",
);
