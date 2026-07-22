import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { AiCfoController } from "./controllers.js";

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

describe("AiCfoController.clearHistory", () => {
  it("limpia toda la conversación compartida que la pantalla muestra", async () => {
    const prisma = {
      chatMessage: { deleteMany: vi.fn(async () => ({ count: 6 })) },
    };
    const controller = new AiCfoController({} as never, prisma as never);

    await expect(controller.clearHistory(actor, "household")).resolves.toEqual({
      removed: 6,
    });
    expect(prisma.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: { householdId: actor.householdId, scope: "household" },
    });
  });

  it("limpia solamente la conversación privada del miembro actual", async () => {
    const prisma = {
      chatMessage: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    };
    const controller = new AiCfoController({} as never, prisma as never);

    await controller.clearHistory(actor, "private");
    expect(prisma.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        householdId: actor.householdId,
        memberId: actor.memberId,
        scope: "private",
      },
    });
  });
});
