import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateMetadataService } from "./private-metadata.service.js";

const previousKey = process.env.PRIVATE_METADATA_ENCRYPTION_KEY;
const previousKeyring = process.env.PRIVATE_METADATA_KEYRING;
const previousKeyringFile = process.env.PRIVATE_METADATA_KEYRING_FILE;

afterEach(() => {
  if (previousKey === undefined) {
    delete process.env.PRIVATE_METADATA_ENCRYPTION_KEY;
  } else {
    process.env.PRIVATE_METADATA_ENCRYPTION_KEY = previousKey;
  }
  if (previousKeyring === undefined) {
    delete process.env.PRIVATE_METADATA_KEYRING;
  } else {
    process.env.PRIVATE_METADATA_KEYRING = previousKeyring;
  }
  if (previousKeyringFile === undefined) {
    delete process.env.PRIVATE_METADATA_KEYRING_FILE;
  } else {
    process.env.PRIVATE_METADATA_KEYRING_FILE = previousKeyringFile;
  }
});

describe("PrivateMetadataService", () => {
  it("cifra con AES-GCM y registra la versión activa del llavero", () => {
    process.env.PRIVATE_METADATA_KEYRING = JSON.stringify({
      activeKeyId: "key-2026-07",
      keys: {
        "key-2026-07": Buffer.alloc(32, 7).toString("base64"),
      },
    });
    const service = new PrivateMetadataService();
    const sealed = service.seal({
      merchant: "Joyería sorpresa",
      category: "Regalos",
    });
    expect(sealed.startsWith("v2.key-2026-07.")).toBe(true);
    expect(sealed).not.toContain("Joyería");
    expect(service.open(sealed)).toEqual({
      merchant: "Joyería sorpresa",
      category: "Regalos",
    });
  });

  it("rota de llave sin perder la capacidad de abrir el historial", () => {
    const oldKey = Buffer.alloc(32, 3).toString("base64");
    const newKey = Buffer.alloc(32, 9).toString("base64");
    process.env.PRIVATE_METADATA_KEYRING = JSON.stringify({
      activeKeyId: "old",
      keys: { old: oldKey },
    });
    const service = new PrivateMetadataService();
    const oldCiphertext = service.seal({ merchant: "Privado" });
    process.env.PRIVATE_METADATA_KEYRING = JSON.stringify({
      activeKeyId: "new",
      keys: { old: oldKey, new: newKey },
    });

    expect(service.needsRotation(oldCiphertext)).toBe(true);
    const rotated = service.rotate(oldCiphertext);
    expect(rotated.startsWith("v2.new.")).toBe(true);
    expect(service.open(rotated)).toEqual({ merchant: "Privado" });
  });

  it("abre v1 durante la migración y lo convierte a v2", () => {
    const legacyKey = Buffer.alloc(32, 5);
    process.env.PRIVATE_METADATA_ENCRYPTION_KEY = legacyKey.toString("base64");
    process.env.PRIVATE_METADATA_KEYRING = JSON.stringify({
      activeKeyId: "new",
      keys: { new: Buffer.alloc(32, 8).toString("base64") },
    });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ merchant: "Histórico" }), "utf8"),
      cipher.final(),
    ]);
    const legacy = [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
    const service = new PrivateMetadataService();

    expect(service.open(legacy)).toEqual({ merchant: "Histórico" });
    expect(service.rotate(legacy).startsWith("v2.new.")).toBe(true);
  });

  it("rechaza una llave activa que no tenga exactamente 32 bytes", () => {
    process.env.PRIVATE_METADATA_KEYRING = JSON.stringify({
      activeKeyId: "invalid",
      keys: {
        invalid: Buffer.alloc(16, 7).toString("base64"),
      },
    });
    expect(() => new PrivateMetadataService().seal({ merchant: "x" })).toThrow(
      "32 bytes",
    );
  });
});
