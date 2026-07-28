import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { IngestionService } from "./ingestion.service.js";

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

describe("IngestionService pending → posted", () => {
  it("fusiona el ID bancario mutado sin crear otra transacción Firefly", async () => {
    const attribution = {
      id: "attribution-1",
      householdId: actor.householdId,
      amount: new Prisma.Decimal("12500"),
      currency: "COP",
      occurredAt: new Date("2026-07-28T12:00:00.000Z"),
      merchant: "Café Bogotá",
      externalTransactionId: "daily:coffee:pending",
      importFingerprint: "fingerprint",
      origin: "OPEN_FINANCE",
      syncStatus: "synchronized",
    };
    let imported = {
      id: "import-1",
      householdId: actor.householdId,
      provider: "mock-sandbox",
      externalId: "daily:coffee:pending",
      attributionId: attribution.id,
      status: "pending",
      createdAt: new Date(),
    };
    let phase: "pending" | "posted" = "pending";
    const importedFindFirst = vi.fn(async ({ where }) => {
      if ("externalId" in where) return null;
      return phase === "posted" ? imported : null;
    });
    const prisma = {
      importedTransaction: {
        findFirst: importedFindFirst,
        create: vi.fn(async ({ data }) => {
          imported = { ...imported, ...data };
          return imported;
        }),
        update: vi.fn(async ({ data }) => {
          imported = { ...imported, ...data };
          return imported;
        }),
      },
      transactionAttribution: {
        findMany: vi.fn(async () => (phase === "posted" ? [attribution] : [])),
        update: vi.fn(async ({ data }) => ({ ...attribution, ...data })),
      },
      incomeSource: { findFirst: vi.fn(async () => null) },
    };
    const transactions = {
      create: vi.fn(async () => attribution),
    };
    const rules = { suggest: vi.fn(async () => null) };
    const service = new IngestionService(
      prisma as never,
      transactions as never,
      rules as never,
    );
    const base = {
      provider: "mock-sandbox",
      type: "withdrawal",
      amount: "12500",
      currency: "COP",
      merchant: "Café Bogotá",
      occurredAt: "2026-07-28T12:00:00.000Z",
      sourceAccountId: "asset-1",
    };

    await service.ingest(
      { ...base, externalId: "daily:coffee:pending", status: "pending" },
      actor,
    );
    phase = "posted";
    const posted = await service.ingest(
      { ...base, externalId: "daily:coffee:posted", status: "posted" },
      actor,
    );

    expect(posted).toEqual(
      expect.objectContaining({
        fuzzyMatched: true,
        fireflyCreated: false,
        statusAdvanced: true,
      }),
    );
    expect(transactions.create).toHaveBeenCalledOnce();
    expect(prisma.importedTransaction.create).toHaveBeenCalledOnce();
    expect(prisma.importedTransaction.update).toHaveBeenCalledOnce();
    expect(imported.externalId).toBe("daily:coffee:posted");
  });
});
