import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "../..");
const dockerAvailable =
  spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status ===
    0 ||
  spawnSync("docker-compose", ["version"], { encoding: "utf8" }).status === 0;
const ephemeralDirectory = mkdtempSync(resolve(tmpdir(), "okle-compose-test-"));
const ephemeralKeyring = resolve(ephemeralDirectory, "keyring.json");
writeFileSync(
  ephemeralKeyring,
  JSON.stringify({
    activeKeyId: "test",
    keys: { test: randomBytes(32).toString("base64") },
  }),
  { mode: 0o600 },
);
process.on("exit", () =>
  rmSync(ephemeralDirectory, { recursive: true, force: true }),
);
const baseEnvironment = {
  ...process.env,
  COMPOSE_DISABLE_ENV_FILE: "true",
  APP_ORIGIN: "https://compose-test.example.invalid",
  APP_LOCAL_PORT: "3100",
  POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  FIREFLY_APP_KEY: `base64:${randomBytes(32).toString("base64")}`,
  AI_CFO_INTERNAL_TOKEN: randomBytes(24).toString("hex"),
  VAPID_PUBLIC_KEY: randomBytes(65).toString("base64url"),
  VAPID_PRIVATE_KEY: randomBytes(32).toString("base64url"),
  PRIVATE_METADATA_KEYRING_HOST_FILE: ephemeralKeyring,
  KEYCLOAK_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
};
delete baseEnvironment.N8N_AUTOMATION_TOKEN;
delete baseEnvironment.N8N_ENCRYPTION_KEY;
const ephemeralN8nToken = randomBytes(24).toString("hex");
const ephemeralN8nEncryptionKey = randomBytes(32).toString("hex");

function renderResult(target, auth, bundledN8n = false, withSecrets = false) {
  const environment = {
    ...baseEnvironment,
    DEPLOY_TARGET: target,
    AUTH_MODE: auth,
    PUBLIC_AUTH_MODE: auth,
    ENABLE_BUNDLED_N8N: String(bundledN8n),
  };
  if (withSecrets) {
    environment.N8N_AUTOMATION_TOKEN = ephemeralN8nToken;
    environment.N8N_ENCRYPTION_KEY = ephemeralN8nEncryptionKey;
  }
  return spawnSync("scripts/compose.sh", ["config", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
}

function render(target, auth, bundledN8n = false, withSecrets = false) {
  const result = renderResult(target, auth, bundledN8n, withSecrets);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test(
  "1. modo local configura sin variables n8n",
  { skip: !dockerAvailable },
  () => {
    assert.equal(renderResult("private", "local").status, 0);
  },
);

test(
  "2. modo Keycloak configura sin variables n8n",
  { skip: !dockerAvailable },
  () => {
    assert.equal(renderResult("public", "keycloak").status, 0);
  },
);

test(
  "3. n8n no aparece en servicios normales",
  { skip: !dockerAvailable },
  () => {
    assert.equal(render("private", "local").services.n8n, undefined);
    assert.equal(render("public", "keycloak").services.n8n, undefined);
  },
);

test(
  "4. Compose n8n opcional falla sin sus secretos",
  { skip: !dockerAvailable },
  () => {
    const result = renderResult("private", "local", true, false);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /N8N_(AUTOMATION_TOKEN|ENCRYPTION_KEY).*obligatorio/,
    );
  },
);

test(
  "5. Compose n8n opcional es válido con secretos efímeros",
  { skip: !dockerAvailable },
  () => {
    const config = render("private", "local", true, true);
    assert.ok(config.services.n8n);
    assert.equal(
      config.services.api.environment.N8N_AUTOMATION_TOKEN,
      ephemeralN8nToken,
    );
  },
);

test("6. n8n integrado no publica puertos", { skip: !dockerAvailable }, () => {
  const config = render("private", "local", true, true);
  assert.equal((config.services.n8n.ports ?? []).length, 0);
});

test(
  "7. solo gateway publica en loopback privado",
  { skip: !dockerAvailable },
  () => {
    const config = render("private", "local");
    for (const [name, service] of Object.entries(config.services)) {
      const ports = service.ports ?? [];
      if (name === "gateway") {
        assert.equal(ports.length, 1);
        assert.equal(ports[0].host_ip, "127.0.0.1");
        assert.equal(String(ports[0].published), "3100");
      } else {
        assert.equal(ports.length, 0, `${name} no debe publicar puertos`);
      }
    }
  },
);
