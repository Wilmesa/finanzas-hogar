import { describe, expect, it, vi } from "vitest";
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
