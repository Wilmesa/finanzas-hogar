import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dockerAvailable =
  spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  }).status === 0;
const baseEnvironment = {
  ...process.env,
  APP_ORIGIN: "https://compose-test.example.invalid",
  APP_LOCAL_PORT: "3100",
  POSTGRES_PASSWORD: "test-only-postgres-password-123456",
  FIREFLY_APP_KEY: `base64:${Buffer.alloc(32).toString("base64")}`,
  AI_CFO_INTERNAL_TOKEN: "test-only-ai-cfo-token-123456789",
  N8N_AUTOMATION_TOKEN: "test-only-automation-token-123456",
  VAPID_PUBLIC_KEY: "A".repeat(87),
  VAPID_PRIVATE_KEY: "B".repeat(43),
  KEYCLOAK_ADMIN_PASSWORD: "test-only-keycloak-password-12345",
};

function render(target, auth) {
  const result = spawnSync(
    "scripts/compose.sh",
    ["config", "--format", "json"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...baseEnvironment,
        DEPLOY_TARGET: target,
        AUTH_MODE: auth,
        PUBLIC_AUTH_MODE: auth,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test(
  "Compose local omite Keycloak, deja n8n inactivo y solo publica gateway en loopback",
  {
    skip: !dockerAvailable,
  },
  () => {
    const config = render("private", "local");
    assert.equal(config.services.keycloak, undefined);
    if (config.services.n8n)
      assert.deepEqual(config.services.n8n.profiles, ["bundled-n8n"]);
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

test(
  "Compose Keycloak opcional conserva una configuración válida",
  {
    skip: !dockerAvailable,
  },
  () => {
    const config = render("public", "keycloak");
    assert.ok(config.services.keycloak);
    assert.equal(config.services.api.environment.AUTH_MODE, "keycloak");
    assert.equal(config.services.web.environment.PUBLIC_AUTH_MODE, "keycloak");
  },
);
