import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { IntegrationsService } from "./integrations.service.js";

const owner: Actor = {
  id: "owner-user",
  memberId: "owner-member",
  householdMemberId: "owner-member",
  householdId: "household-one",
  displayName: "Persona propietaria",
  email: "owner@example.invalid",
  role: "owner",
  roles: ["owner"],
  authProvider: "local",
};

const member: Actor = { ...owner, role: "member", roles: ["member"] };

afterEach(() => {
  delete process.env.OPEN_FINANCE_MOCK_ENABLED;
  delete process.env.OPEN_FINANCE_MOCK_SECRET;
});

describe("IntegrationsService", () => {
  it("distingue la fuente primaria de TRM y el fallback", async () => {
    const prisma = {
      integrationPreference: {
        findUnique: vi.fn().mockResolvedValue({
          trmDailySyncEnabled: true,
          openFinanceMode: "disabled",
        }),
      },
      exchangeRate: {
        findFirst: vi.fn().mockResolvedValue({
          rate: new Decimal("4100.25"),
          effectiveDate: new Date("2026-07-28T00:00:00.000Z"),
          fetchedAt: new Date("2026-07-28T12:00:00.000Z"),
          source: "Superintendencia Financiera de Colombia",
          sourceUrl: "https://example.invalid/sfc",
        }),
      },
    };
    const service = new IntegrationsService(prisma as never, {} as never);

    const status = await service.status(owner);

    expect(status.trm.primarySource).toBe(
      "Superintendencia Financiera de Colombia",
    );
    expect(status.trm.fallbackSource).toBe("Datos Abiertos Colombia");
    expect(status.trm.lastSync?.rate).toBe("4100.25");
    expect(status.openFinance.providerConnected).toBe(false);
  });

  it("no permite activar el sandbox sin configuración segura del servidor", async () => {
    const prisma = {
      integrationPreference: { upsert: vi.fn() },
    };
    const service = new IntegrationsService(prisma as never, {} as never);

    await expect(
      service.update(
        { trmDailySyncEnabled: true, openFinanceMode: "sandbox" },
        owner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.integrationPreference.upsert).not.toHaveBeenCalled();
  });

  it("permite al propietario guardar un sandbox habilitado de forma explícita", async () => {
    process.env.OPEN_FINANCE_MOCK_ENABLED = "true";
    process.env.OPEN_FINANCE_MOCK_SECRET = "s".repeat(32);
    const prisma = {
      integrationPreference: {
        upsert: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          trmDailySyncEnabled: true,
          openFinanceMode: "sandbox",
        }),
      },
      exchangeRate: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new IntegrationsService(prisma as never, {} as never);

    const status = await service.update(
      { trmDailySyncEnabled: true, openFinanceMode: "sandbox" },
      owner,
    );

    expect(prisma.integrationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: owner.householdId },
      }),
    );
    expect(status.openFinance.sandboxAvailable).toBe(true);
    expect(status.openFinance.mode).toBe("sandbox");
  });

  it("reserva la edición de integraciones para la persona propietaria", async () => {
    const service = new IntegrationsService({} as never, {} as never);

    await expect(
      service.update(
        { trmDailySyncEnabled: false, openFinanceMode: "disabled" },
        member,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
