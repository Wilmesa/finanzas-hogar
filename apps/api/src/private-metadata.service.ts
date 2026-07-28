import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

type Keyring = {
  activeKeyId: string;
  keys: Record<string, string>;
};

@Injectable()
export class PrivateMetadataService {
  seal(value: Record<string, unknown>): string {
    const keyring = this.keyring();
    const key = this.decodeKey(
      keyring.keys[keyring.activeKeyId],
      keyring.activeKeyId,
    );
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`okle-private:${keyring.activeKeyId}`, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [
      "v2",
      keyring.activeKeyId,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  open<T extends Record<string, unknown>>(sealed: string): T {
    const parts = sealed.split(".");
    if (parts[0] === "v1") return this.openLegacy<T>(parts);
    if (parts[0] !== "v2" || parts.length !== 5) {
      throw new BadRequestException("Metadatos privados inválidos");
    }
    const [, keyId, iv, tag, ciphertext] = parts;
    if (!keyId || !iv || !tag || !ciphertext) {
      throw new BadRequestException("Metadatos privados inválidos");
    }
    const key = this.decodeKey(this.keyring().keys[keyId], keyId);
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAAD(Buffer.from(`okle-private:${keyId}`, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as T;
    } catch {
      throw new ServiceUnavailableException(
        "No fue posible abrir los metadatos privados",
      );
    }
  }

  needsRotation(sealed: string) {
    const [version, keyId] = sealed.split(".");
    return version !== "v2" || keyId !== this.keyring().activeKeyId;
  }

  rotate(sealed: string) {
    if (!this.needsRotation(sealed)) return sealed;
    return this.seal(this.open(sealed));
  }

  activeKeyId() {
    return this.keyring().activeKeyId;
  }

  private openLegacy<T extends Record<string, unknown>>(parts: string[]): T {
    const [, iv, tag, ciphertext] = parts;
    if (!iv || !tag || !ciphertext || parts.length !== 4) {
      throw new BadRequestException("Metadatos privados inválidos");
    }
    const encoded = process.env.PRIVATE_METADATA_ENCRYPTION_KEY;
    const key = this.decodeKey(encoded, "legacy-v1");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as T;
    } catch {
      throw new ServiceUnavailableException(
        "No fue posible abrir los metadatos privados heredados",
      );
    }
  }

  private keyring(): Keyring {
    const file = process.env.PRIVATE_METADATA_KEYRING_FILE;
    const inline = process.env.PRIVATE_METADATA_KEYRING;
    let parsed: unknown;
    try {
      parsed = JSON.parse(file ? readFileSync(file, "utf8") : (inline ?? ""));
    } catch {
      throw new ServiceUnavailableException(
        "El llavero privado no está disponible o no contiene JSON válido",
      );
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("activeKeyId" in parsed) ||
      !("keys" in parsed)
    ) {
      throw new ServiceUnavailableException(
        "El formato del llavero privado no es válido",
      );
    }
    const activeKeyId = (parsed as { activeKeyId?: unknown }).activeKeyId;
    const keys = (parsed as { keys?: unknown }).keys;
    if (
      typeof activeKeyId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(activeKeyId) ||
      !keys ||
      typeof keys !== "object" ||
      Array.isArray(keys)
    ) {
      throw new ServiceUnavailableException(
        "El formato del llavero privado no es válido",
      );
    }
    const normalized = keys as Record<string, string>;
    this.decodeKey(normalized[activeKeyId], activeKeyId);
    return { activeKeyId, keys: normalized };
  }

  private decodeKey(encoded: string | undefined, keyId: string) {
    if (!encoded) {
      throw new ServiceUnavailableException(
        `No existe material criptográfico para ${keyId}`,
      );
    }
    const key = Buffer.from(encoded, "base64");
    if (
      key.length !== 32 ||
      key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
    ) {
      throw new ServiceUnavailableException(
        `La llave ${keyId} debe contener 32 bytes en Base64`,
      );
    }
    return key;
  }
}
