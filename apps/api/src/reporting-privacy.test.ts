import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { PocketsService } from "./pockets.service.js";
import { TransactionsService } from "./transactions.service.js";
import { AiCfoController } from "./controllers.js";

const actor = { memberId: "a", householdId: "h" } as Actor;
describe("reporting privacy boundaries", () => {
  it("no expone cuentas privadas ni motivos de lotes al otro miembro", async () => {
    const pocket = {
      id: "p",
      householdId: "h",
      ownerMemberId: "b",
      visibility: "household",
      defaultLedgerScope: "private",
      defaultAccountId: "secret-account",
      fundingLots: [
        {
          sourceAccountId: "secret-account",
          reason: "secret-reason",
          remainingAmount: new Prisma.Decimal(10),
        },
      ],
    };
    const prisma = {
      pocket: {
        findMany: vi.fn(async () => [pocket]),
        findUnique: vi.fn(async () => pocket),
      },
    };
    const service = new PocketsService(prisma as never, {} as never);
    const output = JSON.stringify([
      await service.list(actor),
      await service.find("p", actor),
    ]);
    expect(output).not.toContain("secret-account");
    expect(output).not.toContain("secret-reason");
  });
  it("pagina con orden estable y conserva autorización en cada página", async () => {
    const prisma = {
      transactionAttribution: { findMany: vi.fn(async () => []) },
      auditLog: { findMany: vi.fn(async () => []) },
    };
    await new TransactionsService(prisma as never, {} as never).list(
      actor,
      "cursor-1",
    );
    expect(prisma.transactionAttribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "cursor-1" },
        skip: 1,
        take: 200,
        where: expect.objectContaining({
          householdId: "h",
          OR: [
            { ledgerScope: "household" },
            { ledgerScope: "private", payerMemberId: "a" },
          ],
        }),
      }),
    );
  });
  it("el chat no mezcla USD ni anulaciones en el gasto COP", async () => {
    const rows = [
      {
        id: "ok",
        amount: new Prisma.Decimal(10),
        currency: "COP",
        category: "Mercado",
        payerMemberId: "a",
      },
      {
        id: "usd",
        amount: new Prisma.Decimal(100),
        currency: "USD",
        category: "Mercado",
        payerMemberId: "a",
      },
      {
        id: "reversed",
        amount: new Prisma.Decimal(99),
        currency: "COP",
        category: "Mercado",
        payerMemberId: "a",
      },
    ];
    const prisma = {
      household: {
        findUniqueOrThrow: vi.fn(async () => ({ baseCurrency: "COP" })),
      },
      transactionAttribution: { findMany: vi.fn(async () => rows) },
      pocket: { findMany: vi.fn(async () => []) },
      chatMessage: { findMany: vi.fn(async () => []), create: vi.fn() },
      auditLog: {
        findMany: vi.fn(async () => [{ entityId: "reversed", after: null }]),
      },
    };
    const ai = {
      status: vi.fn(async () => ({ generationEnabled: true })),
      chat: vi.fn(async () => ({ content: "Resumen", citations: [] })),
    };
    await new AiCfoController(ai as never, prisma as never).chat(actor, {
      message: "Analiza gastos",
    });
    expect(prisma.transactionAttribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          syncStatus: "synchronized",
          transactionType: "withdrawal",
          ledgerScope: "household",
        }),
      }),
    );
    expect(ai.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          spendingByCategory: [{ category: "Mercado", amount: "10" }],
        }),
      }),
    );
  });
});
