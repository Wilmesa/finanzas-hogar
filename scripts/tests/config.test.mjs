import assert from "node:assert/strict";
import test from "node:test";
import {
  isUnsafeSecret,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  isValidPrivateMetadataKey,
  isValidPrivateMetadataKeyring,
  normalizeAppOrigin,
  parseEnv,
  renderRealm,
} from "../lib/config.mjs";

test("APP_ORIGIN conserva un puerto HTTPS", () => {
  assert.equal(
    normalizeAppOrigin("https://servidor.example.test:8446"),
    "https://servidor.example.test:8446",
  );
});

test("APP_ORIGIN rechaza HTTP, rutas y credenciales", () => {
  for (const value of [
    "http://example.test",
    "https://example.test/auth",
    "https://user:pass@example.test",
  ]) {
    assert.throws(() => normalizeAppOrigin(value));
  }
});

test("renderRealm limita redirect y origen al origen exacto", () => {
  const template = {
    clients: [{ clientId: "finanzas-web", redirectUris: [], webOrigins: [] }],
  };
  const realm = renderRealm(template, "https://example.test:8446");
  assert.deepEqual(realm.clients[0].redirectUris, [
    "https://example.test:8446/*",
  ]);
  assert.deepEqual(realm.clients[0].webOrigins, ["https://example.test:8446"]);
  assert.deepEqual(template.clients[0].redirectUris, []);
});

test("detecta secretos conocidos y conserva valores con igual", () => {
  assert.equal(isUnsafeSecret("change-me-now"), true);
  assert.equal(isUnsafeSecret("GENERATE_ME"), true);
  assert.equal(isUnsafeSecret("a".repeat(32)), false);
  assert.equal(parseEnv("TOKEN=abc=def\n").TOKEN, "abc=def");
});

test("valida el tamaño y alfabeto de claves VAPID", () => {
  assert.equal(isValidVapidPublicKey("A".repeat(87)), true);
  assert.equal(isValidVapidPrivateKey("b".repeat(43)), true);
  assert.equal(isValidVapidPublicKey("GENERATE_ME"), false);
  assert.equal(isValidVapidPrivateKey("con espacios"), false);
});

test("valida una clave AES privada de exactamente 32 bytes", () => {
  assert.equal(
    isValidPrivateMetadataKey(Buffer.alloc(32, 7).toString("base64")),
    true,
  );
  assert.equal(
    isValidPrivateMetadataKey(Buffer.alloc(16, 7).toString("base64")),
    false,
  );
  assert.equal(isValidPrivateMetadataKey("GENERATE_ME"), false);
});

test("valida llavero versionado y rechaza una llave activa ausente", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  assert.equal(
    isValidPrivateMetadataKeyring({
      activeKeyId: "2026-07",
      keys: { "2026-06": key, "2026-07": key },
    }),
    true,
  );
  assert.equal(
    isValidPrivateMetadataKeyring({
      activeKeyId: "missing",
      keys: { "2026-07": key },
    }),
    false,
  );
});
