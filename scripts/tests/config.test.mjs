import assert from "node:assert/strict";
import test from "node:test";
import {
  isUnsafeSecret,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
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
