import { ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { HouseholdAccessService } from "./household-access.service.js";

const owner: Actor = {
  id: "owner-user",
  memberId: "owner-member",
  householdMemberId: "owner-member",
  householdId: "household-one",
  displayName: "Persona propietaria",
  email: "owner@example.invalid",
  role: "owner",
  roles: ["owner"],
  authProvider: "local",
};

const session = {
  token: "opaque-session",
  ttl: 60,
  record: {
    userId: "local-user",
    memberId: "member-one",
    householdId: "household-one",
    passwordVersion: 1,
    csrfToken: "csrf-example",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  },
};

describe("HouseholdAccessService", () => {
  it("crea el primer hogar y propietario en una sola operación", async () => {
    const tx = {
      localUser: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: "local-user",
          email: data.email,
          memberId: data.memberId,
          username: data.username,
          passwordHash: data.passwordHash,
        })),
      },
      household: {
        create: vi.fn().mockResolvedValue({ id: "household-one" }),
      },
      member: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          ...data,
          id: data.id,
        })),
      },
    };
    const prisma = {
      localUser: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn().mockImplementation(async (work) => work(tx)),
    };
    const sessions = { create: vi.fn().mockResolvedValue(session) };
    const service = new HouseholdAccessService(
      prisma as never,
      sessions as never,
    );

    const result = await service.setup({
      householdName: "Hogar de prueba",
      displayName: "Persona propietaria",
      email: "owner@example.invalid",
      username: "owner.qa",
      password: "Example-Only-Password-123",
    });

    expect(result.session.token).toBe("opaque-session");
    expect(tx.household.create).toHaveBeenCalledWith({
      data: {
        name: "Hogar de prueba",
        integrationPreference: { create: {} },
      },
    });
    expect(tx.member.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "owner" }),
      }),
    );
    expect(tx.localUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "owner@example.invalid",
          username: "owner.qa",
          passwordHash: expect.not.stringContaining(
            "Example-Only-Password-123",
          ),
        }),
      }),
    );
  });

  it("solo permite ejecutar el alta inicial una vez", async () => {
    const tx = {
      localUser: { count: vi.fn().mockResolvedValue(1) },
    };
    const prisma = {
      localUser: { count: vi.fn().mockResolvedValue(1) },
      $transaction: vi.fn().mockImplementation(async (work) => work(tx)),
    };
    const service = new HouseholdAccessService(
      prisma as never,
      { create: vi.fn() } as never,
    );

    await expect(
      service.setup({
        householdName: "Segundo hogar",
        displayName: "Otra persona",
        email: "other@example.invalid",
        username: "other.qa",
        password: "Example-Only-Password-456",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("guarda únicamente el hash de una invitación de un solo uso", async () => {
    let storedTokenHash = "";
    const prisma = {
      member: { count: vi.fn().mockResolvedValue(1) },
      householdInvitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          storedTokenHash = data.tokenHash;
          return data;
        }),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (operations) => Promise.all(operations)),
    };
    const service = new HouseholdAccessService(
      prisma as never,
      { create: vi.fn() } as never,
    );

    const invitation = await service.createInvitation(owner);

    expect(invitation.token).toHaveLength(43);
    expect(storedTokenHash).not.toBe(invitation.token);
    expect(storedTokenHash).toBe(
      createHash("sha256").update(invitation.token).digest("hex"),
    );
  });

  it("consume la invitación y crea al segundo miembro", async () => {
    const invitation = {
      id: "invite-one",
      householdId: owner.householdId,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      household: { id: owner.householdId, name: "Hogar de prueba" },
    };
    const tx = {
      householdInvitation: {
        findUnique: vi.fn().mockResolvedValue(invitation),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      member: {
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn().mockImplementation(async ({ data }) => data),
      },
      localUser: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          ...data,
          id: "partner-user",
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (work) => work(tx)),
    };
    const sessions = { create: vi.fn().mockResolvedValue(session) };
    const service = new HouseholdAccessService(
      prisma as never,
      sessions as never,
    );

    const result = await service.join({
      token: "a".repeat(43),
      displayName: "Pareja QA",
      email: "partner@example.invalid",
      username: "partner.qa",
      password: "Example-Only-Password-789",
    });

    expect(result.session.token).toBe("opaque-session");
    expect(tx.householdInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: invitation.id, usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.member.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          householdId: owner.householdId,
          role: "member",
        }),
      }),
    );
  });

  it("no revela una invitación vencida o ya utilizada", async () => {
    const prisma = {
      householdInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          usedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          household: { name: "Hogar privado" },
        }),
      },
    };
    const service = new HouseholdAccessService(
      prisma as never,
      { create: vi.fn() } as never,
    );

    await expect(service.invitation("a".repeat(43))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
