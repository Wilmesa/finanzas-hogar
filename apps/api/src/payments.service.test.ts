import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { PaymentsService } from "./payments.service.js";

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

describe("PaymentsService", () => {
  it("rechaza enlaces de pago no válidos", async () => {
    const service = new PaymentsService({} as never, {} as never);
    await expect(
      service.create(
        {
          name: "Energía",
          type: "service",
          currency: "COP",
          estimatedAmount: "120000",
          nextDueDate: "2026-08-10",
          paymentUrl: "javascript:alert(1)",
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("crea por defecto un pago compartido y su primer vencimiento", async () => {
    const prisma = {
      paymentPlan: {
        create: vi.fn(async ({ data }) => ({ id: "payment-1", ...data })),
      },
    };
    const service = new PaymentsService(prisma as never, {} as never);
    await service.create(
      {
        name: "Internet",
        type: "service",
        currency: "cop",
        estimatedAmount: "99000",
        nextDueDate: "2026-08-15",
      },
      actor,
    );
    expect(prisma.paymentPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          householdId: actor.householdId,
          ownerMemberId: actor.memberId,
          visibility: "household",
          currency: "COP",
          occurrences: expect.any(Object),
        }),
      }),
    );
  });

  it("oculta como inexistente el archivado de un pago ajeno", async () => {
    const prisma = {
      paymentPlan: {
        findFirst: vi.fn(async () => ({
          id: "payment-2",
          householdId: actor.householdId,
          ownerMemberId: "member-b",
          visibility: "household",
          occurrences: [],
        })),
        update: vi.fn(),
      },
    };
    const service = new PaymentsService(prisma as never, {} as never);
    await expect(service.archive("payment-2", actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.paymentPlan.update).not.toHaveBeenCalled();
  });

  it("crea el siguiente vencimiento al confirmar un pago recurrente", async () => {
    const occurrence = {
      id: "occurrence-1",
      householdId: actor.householdId,
      paymentPlanId: "payment-1",
      dueDate: new Date("2026-01-31T00:00:00Z"),
      status: "planned",
      paymentPlan: {
        id: "payment-1",
        householdId: actor.householdId,
        ownerMemberId: actor.memberId,
        visibility: "household",
        recurrence: "monthly",
        dueDay: 31,
        estimatedAmount: "120000",
        currency: "COP",
      },
    };
    const transaction = {
      paymentOccurrence: {
        update: vi.fn(async () => ({ ...occurrence, status: "paid" })),
        findFirst: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }) => ({
          id: "occurrence-2",
          ...create,
        })),
      },
      paymentPlan: { update: vi.fn(async () => ({})) },
      debtAccount: { findFirst: vi.fn(async () => null) },
    };
    const prisma = {
      paymentOccurrence: { findUnique: vi.fn(async () => occurrence) },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    };
    const transactions = {
      create: vi.fn(async () => ({ id: "attribution-1" })),
    };
    const service = new PaymentsService(prisma as never, transactions as never);

    await service.markPaid(
      occurrence.id,
      {
        actualAmount: "118500",
        sourceAccountId: "account-1",
        fundingSourceScope: "household",
      },
      "payment-idempotency-1",
      actor,
    );

    const upsert = transaction.paymentOccurrence.upsert.mock.calls[0]?.[0];
    expect(upsert?.create.dueDate.toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
    expect(transaction.paymentPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: occurrence.paymentPlanId },
        data: expect.objectContaining({ status: "active" }),
      }),
    );
  });
});
