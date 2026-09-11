import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { Actor } from "./auth.js";
import { PlanningService } from "./planning.service.js";

const actor: Actor = {
  id: "user-a",
  memberId: "member-a",
  householdMemberId: "member-a",
  householdId: "household-a",
  displayName: "Miembro A",
  email: "member-a@example.invalid",
  role: "member",
  roles: ["member"],
  authProvider: "local",
};

function expectedIncome() {
  return {
    id: "income-1",
    householdId: actor.householdId,
    sourceId: "source-1",
    expectedDate: new Date("2026-12-15T00:00:00Z"),
    expectedAmount: { toString: () => "6000000" },
    currency: "COP",
    probability: { toString: () => "0.9" },
    status: "planned",
    reason: "Prima de diciembre",
    notes: null,
    actualAmount: null,
    source: {
      id: "source-1",
      householdId: actor.householdId,
      ownerMemberId: actor.memberId,
      visibility: "household",
      currency: "COP",
    },
  };
}

describe("PlanningService expected-income corrections", () => {
  it("ejecutar un plan aplicado con otra clave no crea reservas nuevas", async () => {
    const incomeId = "37f493a0-cf94-4a3f-83d3-3c28124004dd";
    const plan = {
      id: "plan",
      householdId: actor.householdId,
      visibility: "household",
      ownerMemberId: actor.memberId,
      currency: "COP",
      version: 1,
      allocations: [
        {
          id: "allocation",
          pocketId: "pocket",
          pocket: { ownerMemberId: actor.memberId },
          mode: "fixed",
          value: new Prisma.Decimal(100),
          priority: 1,
          executedAmount: new Prisma.Decimal(100),
        },
      ],
    };
    const tx = {
      pocketEvent: { create: vi.fn() },
      planFundingAllocation: { updateMany: vi.fn() },
      planExecution: { create: vi.fn(async () => ({ id: "execution" })) },
      planAuditEvent: { create: vi.fn() },
    };
    const prisma = {
      financialPlan: { findUnique: vi.fn(async () => plan) },
      planExecution: { findUnique: vi.fn(async () => null) },
      expectedIncome: {
        findUnique: vi.fn(async () => ({
          ...expectedIncome(),
          id: incomeId,
          status: "received",
          actualAmount: new Prisma.Decimal(1000),
        })),
      },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const service = new PlanningService(prisma as never, {} as never);
    await service.executePlan(
      "plan",
      { expectedIncomeId: incomeId },
      "different-key",
      actor,
    );
    expect(tx.pocketEvent.create).not.toHaveBeenCalled();
    expect(tx.planFundingAllocation.updateMany).not.toHaveBeenCalled();
    expect(tx.planExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allocationResult: expect.objectContaining({ allocations: [] }),
        }),
      }),
    );
  });
  it("permite editar una proyección mientras sus destinos sigan planeados", async () => {
    const existing = expectedIncome();
    const prisma = {
      expectedIncome: {
        findUnique: vi.fn(async () => existing),
        update: vi.fn(async () => ({ ...existing, reason: "Prima corregida" })),
      },
      incomeSource: { findUnique: vi.fn(async () => existing.source) },
      planFundingAllocation: { findFirst: vi.fn(async () => null) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const service = new PlanningService(prisma as never, {} as never);

    await service.updateExpectedIncome(
      existing.id,
      { reason: "Prima corregida", expectedAmount: "6500000" },
      actor,
    );

    expect(prisma.planFundingAllocation.findFirst).toHaveBeenCalledWith({
      where: { expectedIncomeId: existing.id, status: { not: "planned" } },
      select: { id: true },
    });
    expect(prisma.expectedIncome.update).toHaveBeenCalled();
  });

  it("cancela una proyección no ejecutada sin borrar su trazabilidad", async () => {
    const existing = expectedIncome();
    const prisma = {
      expectedIncome: {
        findUnique: vi.fn(async () => existing),
        update: vi.fn(async () => ({ ...existing, status: "cancelled" })),
      },
      planFundingAllocation: { findFirst: vi.fn(async () => null) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const service = new PlanningService(prisma as never, {} as never);

    await service.cancelExpectedIncome(existing.id, actor);

    expect(prisma.expectedIncome.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existing.id },
        data: { status: "cancelled" },
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
