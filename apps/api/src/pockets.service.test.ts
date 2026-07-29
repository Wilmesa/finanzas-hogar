import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
  const mock = {
    pocket: {
      create: vi.fn(async ({ data }) => ({
        id: "pocket-1",
        ...data,
        version: 1,
      })),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(async () => ({
        id: "pocket-1",
        version: 2,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ data }) => ({
        id: "pocket-1",
        ...data,
      })),
      delete: vi.fn(),
    },
    pocketFundingLot: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(async () => ({
        _sum: { remainingAmount: new Prisma.Decimal(0) },
      })),
    },
    pocketEvent: { create: vi.fn(), count: vi.fn(async () => 0) },
    transactionAttribution: { count: vi.fn(async () => 0) },
    planFundingAllocation: { count: vi.fn(async () => 0) },
    paymentOccurrence: { count: vi.fn(async () => 0) },
    investmentPosition: { count: vi.fn(async () => 0) },
    accountProfile: { findUnique: vi.fn() },
    appNotification: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    ...mock,
    $transaction: vi.fn(
      async (callback: (tx: typeof mock) => Promise<unknown>) => callback(mock),
    ),
  };
}

describe("PocketsService", () => {
  it("crea un bolsillo periódico compartido con JSON y Decimal válidos", async () => {
    const prisma = prismaMock();
    const service = new PocketsService(prisma as never, {} as never);
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
    const service = new PocketsService(prisma as never, {} as never);
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
    const service = new PocketsService(prismaMock() as never, {} as never);
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
    const service = new PocketsService(prisma as never, {} as never);
    await expect(service.find("secret", actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("reserva desde una cuenta real y conserva el origen trazable", async () => {
    const prisma = prismaMock();
    prisma.pocket.findUnique.mockResolvedValue({
      id: "pocket-1",
      householdId: actor.householdId,
      ownerMemberId: actor.memberId,
      visibility: "household",
      currency: "COP",
      currentAmount: new Prisma.Decimal(0),
    });
    const accounts = {
      availableForAllocation: vi.fn(async () => ({
        account: { id: "account-1", currency: "COP" },
        reservedAmount: new Prisma.Decimal(500),
        availableAmount: new Prisma.Decimal(1500),
      })),
      assertOwnedAccount: vi.fn(),
    };
    const service = new PocketsService(prisma as never, accounts as never);

    await service.allocate(
      "pocket-1",
      {
        amount: "1000",
        sourceAccountId: "account-1",
        sourceLedgerScope: "household",
      },
      "allocation-1",
      actor,
    );

    expect(accounts.availableForAllocation).toHaveBeenCalledWith(
      "account-1",
      "household",
      actor,
    );
    expect(prisma.pocketFundingLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pocketId: "pocket-1",
        sourceAccountId: "account-1",
        sourceLedgerScope: "household",
        origin: "account",
      }),
    });
    expect(prisma.pocket.update).toHaveBeenCalledWith({
      where: { id: "pocket-1" },
      data: expect.objectContaining({
        currentAmount: { increment: new Prisma.Decimal(1000) },
      }),
    });
  });

  it("rechaza una reserva mayor al disponible real de la cuenta", async () => {
    const prisma = prismaMock();
    prisma.pocket.findUnique.mockResolvedValue({
      id: "pocket-1",
      householdId: actor.householdId,
      ownerMemberId: actor.memberId,
      visibility: "household",
      currency: "COP",
      currentAmount: new Prisma.Decimal(0),
    });
    const accounts = {
      availableForAllocation: vi.fn(async () => ({
        account: { id: "account-1", currency: "COP" },
        availableAmount: new Prisma.Decimal(100),
      })),
      assertOwnedAccount: vi.fn(),
    };
    const service = new PocketsService(prisma as never, accounts as never);

    await expect(
      service.allocate(
        "pocket-1",
        {
          amount: "101",
          sourceAccountId: "account-1",
          sourceLedgerScope: "household",
        },
        "allocation-2",
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pocketFundingLot.create).not.toHaveBeenCalled();
  });

  it("libera por FIFO únicamente lotes financiados por la cuenta elegida", async () => {
    const prisma = prismaMock();
    prisma.pocket.findUnique.mockResolvedValue({
      id: "pocket-1",
      householdId: actor.householdId,
      ownerMemberId: actor.memberId,
      visibility: "household",
      currency: "COP",
      currentAmount: new Prisma.Decimal(1000),
    });
    prisma.pocketFundingLot.findMany.mockResolvedValue([
      { id: "lot-1", remainingAmount: new Prisma.Decimal(300) },
      { id: "lot-2", remainingAmount: new Prisma.Decimal(700) },
    ]);
    const accounts = {
      assertAccount: vi.fn(async () => ({
        id: "account-1",
        currency: "COP",
      })),
      assertOwnedAccount: vi.fn(),
    };
    const service = new PocketsService(prisma as never, accounts as never);

    await service.release(
      "pocket-1",
      {
        amount: "500",
        targetAccountId: "account-1",
        targetLedgerScope: "household",
      },
      "release-1",
      actor,
    );

    expect(prisma.pocketFundingLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pocketId: "pocket-1",
          sourceAccountId: "account-1",
          sourceLedgerScope: "household",
        }),
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(prisma.pocketFundingLot.update).toHaveBeenNthCalledWith(1, {
      where: { id: "lot-1" },
      data: { remainingAmount: { decrement: new Prisma.Decimal(300) } },
    });
    expect(prisma.pocketFundingLot.update).toHaveBeenNthCalledWith(2, {
      where: { id: "lot-2" },
      data: { remainingAmount: { decrement: new Prisma.Decimal(200) } },
    });
    expect(prisma.pocket.update).toHaveBeenCalledWith({
      where: { id: "pocket-1" },
      data: {
        currentAmount: { decrement: new Prisma.Decimal(500) },
        version: { increment: 1 },
      },
    });
  });

  it("impide que otro miembro disponga de un bolsillo compartido", async () => {
    const prisma = prismaMock();
    prisma.pocket.findUnique.mockResolvedValue({
      id: "shared-pocket",
      householdId: actor.householdId,
      ownerMemberId: "member-2",
      visibility: "household",
      currency: "COP",
      currentAmount: new Prisma.Decimal(500),
    });
    const accounts = {
      availableForAllocation: vi.fn(),
      assertOwnedAccount: vi.fn(),
    };
    const service = new PocketsService(prisma as never, accounts as never);

    await expect(
      service.allocate(
        "shared-pocket",
        {
          amount: "100",
          sourceAccountId: "account-1",
          sourceLedgerScope: "household",
        },
        "forbidden-allocation",
        actor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accounts.availableForAllocation).not.toHaveBeenCalled();
  });

  it("vincula el saldo legado únicamente a una cuenta del creador", async () => {
    const prisma = prismaMock();
    prisma.pocket.findUnique.mockResolvedValue({
      id: "pocket-1",
      householdId: actor.householdId,
      ownerMemberId: actor.memberId,
      visibility: "household",
      currency: "COP",
      currentAmount: new Prisma.Decimal(900),
      version: 1,
    });
    prisma.pocketFundingLot.aggregate.mockResolvedValue({
      _sum: { remainingAmount: new Prisma.Decimal(900) },
    });
    const accounts = {
      availableForAllocation: vi.fn(async () => ({
        account: { id: "account-1", currency: "COP" },
        availableAmount: new Prisma.Decimal(1000),
      })),
      assertOwnedAccount: vi.fn(),
    };
    const service = new PocketsService(prisma as never, accounts as never);

    await service.linkAccount(
      "pocket-1",
      {
        accountId: "account-1",
        ledgerScope: "household",
        version: 1,
      },
      actor,
    );

    expect(accounts.assertOwnedAccount).toHaveBeenCalledWith(
      "account-1",
      "household",
      actor.memberId,
      actor,
    );
    expect(prisma.pocketFundingLot.updateMany).toHaveBeenCalledWith({
      where: {
        pocketId: "pocket-1",
        sourceAccountId: null,
        remainingAmount: { gt: 0 },
      },
      data: expect.objectContaining({
        sourceAccountId: "account-1",
        sourceLedgerScope: "household",
        origin: "legacy_reconciliation",
      }),
    });
  });

  it("elimina un bolsillo creado por error sin crear movimientos", async () => {
    const prisma = prismaMock();
    prisma.pocket.findUnique.mockResolvedValue({
      id: "pocket-1",
      householdId: actor.householdId,
      ownerMemberId: actor.memberId,
      visibility: "household",
      currency: "COP",
      currentAmount: new Prisma.Decimal(5_000_000),
    });
    const service = new PocketsService(prisma as never, {} as never);

    await service.deleteCreatedByMistake(
      "pocket-1",
      {
        confirmation: "ELIMINAR",
        reason: "Saldo digitado por error",
      },
      actor,
    );

    expect(prisma.pocket.delete).toHaveBeenCalledWith({
      where: { id: "pocket-1" },
    });
    expect(prisma.pocketEvent.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "deleted_as_mistake" }),
    });
  });
});
