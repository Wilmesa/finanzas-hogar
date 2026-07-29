import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { TransactionsService } from "./transactions.service.js";

const actor: Actor = {
  id: "user-a",
  memberId: "member-a",
  householdMemberId: "member-a",
  householdId: "household-a",
  displayName: "Miembro A",
  email: "a@example.invalid",
  role: "member",
  roles: ["member"],
  authProvider: "local",
};

describe("TransactionsService idempotency", () => {
  it("responde el mismo registro a tres reintentos sin volver a llamar Firefly", async () => {
    const existing = {
      id: "attribution-1",
      householdId: actor.householdId,
      idempotencyKey: "offline-uuid",
      syncStatus: "synchronized",
    };
    const prisma = {
      transactionAttribution: {
        findUnique: vi.fn(async () => existing),
      },
    };
    const firefly = {
      listAssetAccounts: vi.fn(),
      createTransaction: vi.fn(),
    };
    const service = new TransactionsService(prisma as never, firefly as never);
    const input = {
      type: "withdrawal" as const,
      amount: "12000",
      currency: "COP",
      description: "Café",
      sourceId: "account-1",
      occurredAt: "2026-07-27T10:00:00.000Z",
    };
    const results = await Promise.all([
      service.create(input, "offline-uuid", actor, {
        origin: "OFFLINE_SYNC",
      }),
      service.create(input, "offline-uuid", actor, {
        origin: "OFFLINE_SYNC",
      }),
      service.create(input, "offline-uuid", actor, {
        origin: "OFFLINE_SYNC",
      }),
    ]);
    expect(results).toEqual([existing, existing, existing]);
    expect(firefly.createTransaction).not.toHaveBeenCalled();
    expect(firefly.listAssetAccounts).not.toHaveBeenCalled();
  });

  it("usa el libro privado cuando la cuenta elegida es privada", async () => {
    const pending = {
      id: "private-pending",
      syncStatus: "processing",
    };
    const synchronized = {
      ...pending,
      fireflyTransactionId: "firefly-private-1",
      syncStatus: "synchronized",
    };
    const tx = {
      transactionAttribution: {
        update: vi.fn(async () => synchronized),
        upsert: vi.fn(),
      },
      accountProfile: { findUnique: vi.fn() },
      appNotification: { create: vi.fn() },
    };
    const prisma = {
      transactionAttribution: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => pending),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(),
      },
      member: { findFirst: vi.fn(async () => ({ id: actor.memberId })) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const firefly = {
      listAssetAccounts: vi.fn(async () => [
        { id: "private-account", currency: "COP" },
      ]),
      createTransaction: vi.fn(async () => ({
        data: { id: "firefly-private-1" },
      })),
    };
    const privateMetadata = { seal: vi.fn(() => "sealed") };
    const service = new TransactionsService(
      prisma as never,
      firefly as never,
      privateMetadata as never,
    );

    await service.create(
      {
        type: "withdrawal",
        amount: "12000",
        currency: "COP",
        description: "Gasto privado",
        category: "Personal",
        sourceId: "private-account",
        occurredAt: "2026-07-27T10:00:00.000Z",
        fundingSourceScope: "private",
      },
      "private-command",
      actor,
    );

    expect(firefly.listAssetAccounts).toHaveBeenCalledWith(
      "private",
      actor.memberId,
    );
    expect(firefly.createTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      "private",
      actor.memberId,
    );
    expect(prisma.transactionAttribution.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ledgerScope: "private",
          sourceAccountId: "private-account",
        }),
      }),
    );
  });

  it("revierte con un asiento compensatorio y conserva el original", async () => {
    const existing = {
      id: "original-withdrawal",
      householdId: actor.householdId,
      ledgerScope: "household",
      payerMemberId: actor.memberId,
      merchant: "Compra reversada",
      category: "Mercado",
      amount: new Prisma.Decimal("45000"),
      currency: "COP",
      transactionType: "withdrawal",
      spendingNature: "household",
      sourceAccountId: "account-1",
      destinationAccountId: null,
      syncStatus: "synchronized",
      occurredAt: new Date(),
    };
    const prisma = {
      transactionAttribution: {
        findFirst: vi.fn(async () => existing),
      },
      auditLog: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
    };
    const service = new TransactionsService(prisma as never, {} as never);
    const create = vi
      .spyOn(service, "create")
      .mockResolvedValue({ id: "reversal-deposit" } as never);

    await expect(
      service.reverse("original-withdrawal", "reverse-command", actor),
    ).resolves.toEqual({
      originalId: "original-withdrawal",
      reversalId: "reversal-deposit",
      replayed: false,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "deposit",
        amount: "45000",
        destinationId: "account-1",
      }),
      "reversal:original-withdrawal",
      actor,
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: "original-withdrawal",
        action: "reversed",
        after: {
          reversalId: "reversal-deposit",
          commandIdempotencyKey: "reverse-command",
        },
      }),
    });
  });

  it("revela metadatos privados solo en la bandeja del propietario", async () => {
    const prisma = {
      transactionAttribution: {
        findMany: vi.fn(async () => [
          {
            id: "private-attribution",
            ledgerScope: "private",
            payerMemberId: actor.memberId,
            merchant: "Consumo Personal",
            category: null,
            privateMetadataCiphertext: "ciphertext",
          },
        ]),
      },
    };
    const privateMetadata = {
      open: vi.fn(() => ({
        merchant: "Regalo sorpresa",
        category: "Regalos",
      })),
    };
    const service = new TransactionsService(
      prisma as never,
      {} as never,
      privateMetadata as never,
    );

    await expect(service.reviewQueue(actor)).resolves.toEqual([
      expect.objectContaining({
        merchant: "Regalo sorpresa",
        category: "Regalos",
        privateMetadataCiphertext: undefined,
      }),
    ]);
  });

  it("reclasifica el gasto sin alterar reservas y mantiene privada la categoría", async () => {
    const oldPocketId = "11111111-1111-4111-8111-111111111111";
    const newPocketId = "22222222-2222-4222-8222-222222222222";
    const existing = {
      id: "attribution-private",
      householdId: actor.householdId,
      ledgerScope: "private",
      payerMemberId: actor.memberId,
      pocketId: oldPocketId,
      transactionType: "withdrawal",
      fireflyTransactionId: "firefly-1",
      amount: new Prisma.Decimal("25000"),
      currency: "COP",
      merchant: "Consumo Personal",
      category: null,
      privateMetadataCiphertext: "ciphertext",
    };
    const pocketEventCreate = vi.fn(async ({ data }) => ({
      id: `event-${data.type}`,
      ...data,
    }));
    const pocketUpdate = vi.fn(async ({ where, data }) => ({ where, data }));
    const attributionUpdate = vi.fn(async ({ data }) => ({
      ...existing,
      ...data,
    }));
    const tx = {
      pocketEvent: {
        findFirst: vi.fn(async () => ({
          id: "old-spent-event",
          pocketId: oldPocketId,
        })),
        create: pocketEventCreate,
      },
      pocket: { update: pocketUpdate },
      transactionAttribution: { update: attributionUpdate },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      transactionAttribution: {
        findFirst: vi.fn(async () => existing),
      },
      pocket: {
        findFirst: vi.fn(async () => ({
          id: newPocketId,
          householdId: actor.householdId,
          currency: "COP",
          visibility: "private",
          ownerMemberId: actor.memberId,
        })),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const privateMetadata = {
      open: vi.fn(() => ({
        merchant: "Regalo sorpresa",
        category: "Compras",
      })),
      seal: vi.fn(() => "new-ciphertext"),
    };
    const service = new TransactionsService(
      prisma as never,
      {} as never,
      privateMetadata as never,
    );

    await service.review(
      "attribution-private",
      {
        status: "REVIEWED",
        category: "Regalos",
        pocketId: newPocketId,
      },
      "review-command",
      actor,
    );

    expect(privateMetadata.seal).toHaveBeenCalledWith({
      merchant: "Regalo sorpresa",
      category: "Regalos",
    });
    expect(attributionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: null,
          privateMetadataCiphertext: "new-ciphertext",
          pocketId: newPocketId,
        }),
      }),
    );
    expect(pocketEventCreate).not.toHaveBeenCalled();
    expect(pocketUpdate).not.toHaveBeenCalled();
  });

  it("re-encripta únicamente el historial privado del miembro actual", async () => {
    const update = vi.fn(async () => ({}));
    const auditCreate = vi.fn(async () => ({}));
    const tx = {
      transactionAttribution: { update },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      auditLog: { findFirst: vi.fn(async () => null) },
      transactionAttribution: {
        findMany: vi.fn(async () => [
          { id: "private-1", privateMetadataCiphertext: "v2.old.one" },
          { id: "private-2", privateMetadataCiphertext: "v2.new.two" },
        ]),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const privateMetadata = {
      activeKeyId: vi.fn(() => "new"),
      needsRotation: vi.fn((sealed: string) => sealed.includes(".old.")),
      rotate: vi.fn(() => "v2.new.rotated"),
    };
    const service = new TransactionsService(
      prisma as never,
      {} as never,
      privateMetadata as never,
    );

    await expect(
      service.rotatePrivateMetadata("rotation-command", actor),
    ).resolves.toEqual({
      activeKeyId: "new",
      recordsRotated: 1,
      replayed: false,
    });
    expect(prisma.transactionAttribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          householdId: actor.householdId,
          payerMemberId: actor.memberId,
          ledgerScope: "private",
        }),
      }),
    );
    expect(update).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});
