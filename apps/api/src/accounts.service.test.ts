import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AccountsService } from "./accounts.service.js";
import type { Actor } from "./auth.js";

const actor = { memberId: "member-a", householdId: "household-a" } as Actor;
function fixture() {
  const account = {
    id: "1",
    name: "Nómina",
    currency: "COP",
    currentBalance: "1000",
    scope: "household",
  };
  const prisma = {
    member: { findFirst: vi.fn(async () => null) },
    accountProfile: { upsert: vi.fn() },
    pocket: { findFirst: vi.fn(async () => null) },
  };
  const firefly = {
    listAssetAccounts: vi.fn(async () => [account]),
    updateAccount: vi.fn(async () => account),
  };
  return {
    prisma,
    firefly,
    service: new AccountsService(prisma as never, firefly as never),
  };
}

describe("Account editing boundaries", () => {
  it("edita solo el color sin enviar un PUT vacío ni reiniciar principal/icono", async () => {
    const { service, prisma, firefly } = fixture();
    await service.update("1", "household", { color: "#FFAA00" }, actor);
    expect(firefly.updateAccount).not.toHaveBeenCalled();
    expect(prisma.accountProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { color: "#FFAA00" } }),
    );
  });
  it("valida el propietario antes de cambiar el nombre real", async () => {
    const { service, prisma, firefly } = fixture();
    await expect(
      service.update(
        "1",
        "household",
        { name: "Renombrada", ownerMemberId: "outsider" },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(firefly.updateAccount).not.toHaveBeenCalled();
    expect(prisma.accountProfile.upsert).not.toHaveBeenCalled();
  });
  it("rechaza metadata inválida antes de tocar Firefly", async () => {
    const { service, firefly } = fixture();
    await expect(
      service.update(
        "1",
        "household",
        { name: "Renombrada", color: "red" },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(firefly.updateAccount).not.toHaveBeenCalled();
  });
  it("no convierte el saldo cambiando la etiqueta de moneda", async () => {
    const { service, firefly } = fixture();
    await expect(
      service.update("1", "household", { currency: "USD" }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(firefly.updateAccount).not.toHaveBeenCalled();
  });
});
