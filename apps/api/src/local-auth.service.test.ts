import { HttpException, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAuthService } from "./local-auth.service.js";
import { hashPassword } from "./password.js";
import type { PrismaService } from "./prisma.service.js";
import type { SessionStore, StoredSession } from "./session-store.js";

const password = "Example-Only-Password-123";
const member = {
  id: "member-a",
  householdId: "household-one",
  displayName: "Miembro A",
  email: "a@example.invalid",
  role: "owner",
  createdAt: new Date(),
};

function session(memberId = member.id): StoredSession {
  return {
    userId: "user-a",
    memberId,
    householdId: member.householdId,
    passwordVersion: 1,
    csrfToken: "csrf-example",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

describe("LocalAuthService", () => {
  let user: Awaited<ReturnType<typeof makeUser>>;
  let prisma: {
    localUser: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let sessions: {
    consumeLoginAttempt: ReturnType<typeof vi.fn>;
    clearLoginAttempts: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    destroyAll: ReturnType<typeof vi.fn>;
  };
  let service: LocalAuthService;

  async function makeUser(active = true) {
    return {
      id: "user-a",
      memberId: member.id,
      email: member.email,
      username: "member-a",
      passwordHash: await hashPassword(password),
      isActive: active,
      passwordVersion: 1,
      passwordChangedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      member,
    };
  }

  beforeEach(async () => {
    user = await makeUser();
    prisma = {
      localUser: {
        findFirst: vi.fn().mockResolvedValue(user),
        findUnique: vi.fn().mockResolvedValue(user),
        update: vi.fn().mockResolvedValue(user),
      },
    };
    sessions = {
      consumeLoginAttempt: vi.fn().mockResolvedValue(true),
      clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
      create: vi
        .fn()
        .mockResolvedValue({ token: "opaque", record: session(), ttl: 60 }),
      get: vi.fn().mockResolvedValue(session()),
      destroy: vi.fn().mockResolvedValue(undefined),
      destroyAll: vi.fn().mockResolvedValue(undefined),
    };
    service = new LocalAuthService(
      prisma as unknown as PrismaService,
      sessions as unknown as SessionStore,
    );
  });

  it("creates a session for a correct email or username and never returns a password", async () => {
    const result = await service.login(" MEMBER-A ", password, "100.64.0.1");
    expect(result.session.token).toBe("opaque");
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: member.id }),
    );
    expect(sessions.clearLoginAttempts).toHaveBeenCalledWith(
      "member-a",
      "100.64.0.1",
    );
  });

  it("returns a generic error for an incorrect password", async () => {
    await expect(
      service.login("member-a", "Wrong-Password-Example-456", "100.64.0.2"),
    ).rejects.toThrow("Credenciales incorrectas");
  });

  it("returns the same generic error for a missing user", async () => {
    prisma.localUser.findFirst.mockResolvedValue(null);
    await expect(
      service.login("missing", password, "100.64.0.2"),
    ).rejects.toThrow("Credenciales incorrectas");
  });

  it("returns the same generic error for a disabled user", async () => {
    prisma.localUser.findFirst.mockResolvedValue(await makeUser(false));
    await expect(
      service.login("member-a", password, "100.64.0.2"),
    ).rejects.toThrow("Credenciales incorrectas");
  });

  it("enforces Redis rate limiting", async () => {
    sessions.consumeLoginAttempt.mockResolvedValue(false);
    await expect(
      service.login("member-a", password, "100.64.0.3"),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.localUser.findFirst).not.toHaveBeenCalled();
  });

  it("rejects expired sessions", async () => {
    sessions.get.mockResolvedValue(null);
    await expect(service.authenticate("expired-token")).resolves.toBeNull();
  });

  it("prevents a session from crossing member or household boundaries", async () => {
    sessions.get.mockResolvedValue(session("member-b"));
    await expect(service.authenticate("member-b-token")).resolves.toBeNull();
    expect(sessions.destroy).toHaveBeenCalledWith("member-b-token", "member-b");
  });

  it("logs out and revokes all sessions after a password change", async () => {
    await service.logout("opaque", session());
    expect(sessions.destroy).toHaveBeenCalledWith("opaque", member.id);
    await service.changePassword(
      user.id,
      password,
      "A-Different-Example-Password-789",
    );
    expect(prisma.localUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id },
        data: expect.objectContaining({ passwordVersion: { increment: 1 } }),
      }),
    );
    expect(sessions.destroyAll).toHaveBeenCalledWith(member.id);
  });

  it("rejects a wrong current password", async () => {
    await expect(
      service.changePassword(
        user.id,
        "Wrong-Current-Password-123",
        "New-Password-Example-456",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
