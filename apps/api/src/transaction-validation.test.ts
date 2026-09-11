import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { TransactionsService } from "./transactions.service.js";

const actor = { memberId: "a", householdId: "h" } as Actor;
const income = {
  type: "deposit" as const,
  amount: "1000",
  currency: "COP",
  destinationId: "1",
  description: "Nómina",
  occurredAt: new Date().toISOString(),
};
function fixture() {
  const pending = { id: "pending" };
  const prisma = {
    transactionAttribution: {
      findUnique: vi.fn(async (): Promise<unknown> => null),
      upsert: vi.fn(async () => pending),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({ ...pending, syncStatus: "synchronized" })),
    },
    member: { findFirst: vi.fn(async () => ({ id: "a" })) },
  };
  const firefly = {
    listAssetAccounts: vi.fn(async () => [
      { id: "1", currency: "COP" },
      { id: "2", currency: "USD" },
    ]),
    createTransaction: vi.fn(async () => ({ data: { id: "ff-1" } })),
  };
  const db = {
    ...prisma,
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    ),
  };
  return {
    prisma,
    firefly,
    service: new TransactionsService(db as never, firefly as never),
  };
}
describe("transaction contract", () => {
  it("un resultado de red ambiguo se recupera sin volver a enviar el gasto", async () => {
    const { service, prisma, firefly } = fixture();
    prisma.transactionAttribution.findUnique.mockResolvedValue({
      syncStatus: "failed",
      fireflyTransactionId: "already-created",
    });
    await service.create(income, "key", actor);
    expect(firefly.createTransaction).not.toHaveBeenCalled();
  });
  it("incluye la fuente de ingreso exigida por Firefly", async () => {
    const { service, firefly } = fixture();
    await service.create(income, "key", actor);
    expect(firefly.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        transactions: [
          expect.objectContaining({
            type: "deposit",
            source_name: "Nómina",
            destination_id: "1",
          }),
        ],
      }),
      "household",
      "a",
    );
  });
  it("rechaza una transferencia entre monedas sin tasa explícita", async () => {
    const { service, firefly } = fixture();
    await expect(
      service.create(
        { ...income, type: "transfer", sourceId: "1", destinationId: "2" },
        "key",
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(firefly.createTransaction).not.toHaveBeenCalled();
  });
  it("rechaza una transferencia hacia la misma cuenta", async () => {
    const { service } = fixture();
    await expect(
      service.create(
        { ...income, type: "transfer", sourceId: "1" },
        "key",
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it("no reutiliza una clave para cambiar el importe", async () => {
    const { service, prisma, firefly } = fixture();
    prisma.transactionAttribution.findUnique.mockResolvedValue({
      amount: new Prisma.Decimal(500),
      currency: "COP",
      syncStatus: "synchronized",
    });
    await expect(service.create(income, "key", actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(firefly.createTransaction).not.toHaveBeenCalled();
  });
  it("no devuelve un movimiento privado ajeno por conocer su clave", async () => {
    const { service, prisma } = fixture();
    prisma.transactionAttribution.findUnique.mockResolvedValue({
      ledgerScope: "private",
      payerMemberId: "b",
      syncStatus: "synchronized",
    });
    await expect(service.create(income, "key", actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
