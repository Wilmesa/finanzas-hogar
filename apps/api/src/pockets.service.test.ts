import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { PocketsService } from "./pockets.service.js";

const actor: Actor = {
  id: "user-1",
  memberId: "member-1",
  householdMemberId: "member-1",
  householdId: "household-1",
  displayName: "Persona real",
  email: "person@example.invalid",
  role: "owner",
  roles: ["owner"],
  authProvider: "local",
};

function prismaMock() {
  return {
    pocket: {
      create: vi.fn(async ({ data }) => ({
        id: "pocket-1",
        ...data,
        version: 1,
      })),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(),
    },
  };
}

describe("PocketsService", () => {
  it("crea un bolsillo periódico compartido con JSON y Decimal válidos", async () => {
    const prisma = prismaMock();
    const service = new PocketsService(prisma as never);
    const result = await service.create(
      {
        name: "Mercado",
        purpose: "custom",
        notes: "Compras y transporte del hogar",
        visibility: "household",
        currency: "COP",
        policy: { kind: "periodic_spend", limit: "1000000", period: "monthly" },
      },
      actor,
    );
    expect(result.visibility).toBe("household");
    expect(result.notes).toBe("Compras y transporte del hogar");
    expect(result.ownerMemberId).toBe(actor.memberId);
    expect(prisma.pocket.create).toHaveBeenCalledOnce();
  });

  it("crea un bolsillo privado sin cambiar el hogar del actor", async () => {
    const prisma = prismaMock();
    const service = new PocketsService(prisma as never);
    const result = await service.create(
      {
        name: "Sorpresa",
        purpose: "purchase",
        visibility: "private",
        currency: "USD",
        policy: {
          kind: "target_by_contribution",
          targetAmount: "3000",
          contributionAmount: "250",
          frequency: "monthly",
        },
      },
      actor,
    );
    expect(result.visibility).toBe("private");
    expect(result.householdId).toBe(actor.householdId);
  });

  it("convierte datos inválidos en HTTP 400 con campos útiles", () => {
    const service = new PocketsService(prismaMock() as never);
    expect(() =>
      service.create(
        {
          name: "Mercado",
          purpose: "daily_spend",
          currency: "COP",
          policy: { kind: "periodic_spend", limit: "", period: "monthly" },
        },
        actor,
      ),
    ).toThrow(BadRequestException);
  });

  it("responde 404 para un bolsillo privado ajeno", async () => {
    const prisma = prismaMock();
    prisma.pocket.findUnique.mockResolvedValue({
      id: "secret",
      householdId: actor.householdId,
      ownerMemberId: "another-member",
      visibility: "private",
    });
    const service = new PocketsService(prisma as never);
    await expect(service.find("secret", actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
