import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { HouseholdService } from "./household.service.js";

const memberActor: Actor = {
  id: "user",
  memberId: "member",
  householdMemberId: "member",
  householdId: "household",
  displayName: "Nombre real",
  email: "real@example.invalid",
  role: "member",
  roles: ["member"],
  authProvider: "local",
};

describe("HouseholdService", () => {
  it("solo modifica el perfil del actor autenticado", async () => {
    const prisma = {
      member: {
        update: vi.fn(async ({ where, data }) => ({
          id: where.id,
          email: memberActor.email,
          role: "member",
          avatar: null,
          ...data,
        })),
      },
    };
    const service = new HouseholdService(prisma as never, {} as never);
    const result = await service.updateProfile(memberActor, {
      displayName: "Nombre actualizado",
      color: "#2563EB",
    });
    expect(result.id).toBe(memberActor.memberId);
    expect(prisma.member.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: memberActor.memberId } }),
    );
  });

  it("impide a un miembro cambiar el nombre del hogar", async () => {
    const service = new HouseholdService({} as never, {} as never);
    await expect(
      service.updateHousehold(memberActor, { name: "Otro hogar" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
