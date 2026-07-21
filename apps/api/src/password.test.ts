import { describe, expect, it } from "vitest";
import { hashPassword, validatePassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("uses salted scrypt and verifies only the correct password", async () => {
    const first = await hashPassword("NotARealPassword-123");
    const second = await hashPassword("NotARealPassword-123");
    expect(first).toMatch(/^scrypt\$v=1\$N=65536,r=8,p=1\$/);
    expect(first).not.toBe(second);
    await expect(verifyPassword("NotARealPassword-123", first)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("Incorrect-Password-456", first)).resolves.toBe(
      false,
    );
  });

  it("rejects weak or oversized passwords", () => {
    expect(() => validatePassword("short")).toThrow(/12 y 128/);
    expect(() => validatePassword("x".repeat(129))).toThrow(/12 y 128/);
  });
});
