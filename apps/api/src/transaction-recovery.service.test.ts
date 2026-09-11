import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TransactionRecoveryService } from "./transaction-recovery.service.js";

function fixture(privateRecord = false) {
  const record = {
    id: "t",
    householdId: "h",
    payerMemberId: "a",
    ledgerScope: privateRecord ? "private" : "household",
    syncStatus: "processing",
    lastSyncAttemptAt: new Date(0),
    occurredAt: new Date(),
    idempotencyKey: "key",
    amount: new Prisma.Decimal(100),
    currency: "COP",
    transactionType: "withdrawal",
    sourceAccountId: "1",
    destinationAccountId: null,
  };
  const tx = {
    transactionAttribution: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      upsert: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    transactionAttribution: { findMany: vi.fn(async () => [record]) },
    $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const firefly = {
    hasToken: vi.fn(() => true),
    findTransactionByReference: vi.fn(
      async (): Promise<{ data: { id: string } } | null> => ({
        data: { id: "ff" },
      }),
    ),
    createTransaction: vi.fn(),
  };
  return {
    tx,
    prisma,
    firefly,
    service: new TransactionRecoveryService(prisma as never, firefly as never),
  };
}

describe("recovery never re-posts money", () => {
  it("recupera un acuse perdido mediante referencia e importe sin segundo POST", async () => {
    const { service, tx, firefly, prisma } = fixture();
    expect(
      (await service.reconcile({ memberId: "a", householdId: "h" })).recovered,
    ).toBe(1);
    expect(firefly.createTransaction).not.toHaveBeenCalled();
    expect(tx.transactionAttribution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          syncStatus: "synchronized",
          fireflyTransactionId: "ff",
        }),
      }),
    );
    expect(prisma.transactionAttribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ householdId: "h" }),
      }),
    );
  });
  it("no da por completado ni reenvía lo que no encuentra", async () => {
    const { service, tx, firefly } = fixture();
    firefly.findTransactionByReference.mockResolvedValue(null);
    const result = await service.reconcile({ memberId: "a", householdId: "h" });
    expect(result.requiresReview).toBe(1);
    expect(tx.transactionAttribution.updateMany).not.toHaveBeenCalled();
    expect(firefly.createTransaction).not.toHaveBeenCalled();
  });
  it("rechaza referencias ambiguas entre contextos privados y compartidos", async () => {
    const { service, tx } = fixture(true);
    expect(
      (await service.reconcile({ memberId: "a", householdId: "h" }))
        .requiresReview,
    ).toBe(1);
    expect(tx.transactionAttribution.updateMany).not.toHaveBeenCalled();
  });
  it("restituye solo una asignación genérica si el gasto secreto salió del libro común", async () => {
    const { service, tx, firefly } = fixture(true);
    firefly.findTransactionByReference.mockResolvedValueOnce(null);
    expect(
      (await service.reconcile({ memberId: "a", householdId: "h" })).recovered,
    ).toBe(1);
    expect(tx.transactionAttribution.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          merchant: "Asignación personal",
          ledgerScope: "household",
        }),
      }),
    );
    expect(
      JSON.stringify(tx.transactionAttribution.upsert.mock.calls),
    ).not.toContain("privateMetadataCiphertext");
  });
});
