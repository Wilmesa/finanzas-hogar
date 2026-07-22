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
    const service = new PaymentsService({} as never);
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
    const service = new PaymentsService(prisma as never);
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
    const service = new PaymentsService(prisma as never);
    await expect(service.archive("payment-2", actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.paymentPlan.update).not.toHaveBeenCalled();
  });
});
