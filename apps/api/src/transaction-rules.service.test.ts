import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { TransactionRulesService } from "./transaction-rules.service.js";

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

describe("TransactionRulesService", () => {
  it("aplica la primera regla importada por prioridad", async () => {
    const prisma = {
      transactionRule: {
        findMany: vi.fn(async () => [
          {
            id: "rule-1",
            name: "Rappi",
            conditions: {
              merchantPattern: "rappi",
              transactionType: "withdrawal",
            },
            actions: {
              category: "Restaurantes",
              reviewStatus: "REVIEWED",
            },
          },
        ]),
      },
    };
    const service = new TransactionRulesService(prisma as never);
    await expect(
      service.suggest(
        {
          merchant: "RAPPI * BURGER",
          amount: "42000",
          currency: "COP",
          type: "withdrawal",
        },
        actor,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        ruleId: "rule-1",
        category: "Restaurantes",
        reviewStatus: "REVIEWED",
      }),
    );
  });

  it("no aplica la regla a un comercio diferente", async () => {
    const prisma = {
      transactionRule: {
        findMany: vi.fn(async () => [
          {
            id: "rule-1",
            name: "Rappi",
            conditions: { merchantPattern: "^rappi" },
            actions: { category: "Restaurantes" },
          },
        ]),
      },
    };
    const service = new TransactionRulesService(prisma as never);
    await expect(
      service.suggest(
        {
          merchant: "Mercado local",
          amount: "42000",
          currency: "COP",
          type: "withdrawal",
        },
        actor,
      ),
    ).resolves.toBeNull();
  });
});
