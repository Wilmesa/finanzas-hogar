import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "./auth.js";
import { AccountsController } from "./controllers.js";
import { AccountsService } from "./accounts.service.js";
import { FireflyClient } from "./firefly.client.js";

const actor: Actor = {
  id: "user",
  memberId: "member-a",
  householdMemberId: "member-a",
  householdId: "household",
  displayName: "Persona",
  email: "person@example.invalid",
  role: "owner",
  roles: ["owner"],
  authProvider: "local",
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FIREFLY_BASE_URL;
  delete process.env.FIREFLY_HOUSEHOLD_TOKEN;
  delete process.env.FIREFLY_PRIVATE_TOKEN_MEMBER_A;
});

describe("Firefly accounts", () => {
  it("crea una cuenta en el alcance seleccionado sin exponer el token", async () => {
    process.env.FIREFLY_BASE_URL = "http://firefly.test";
    process.env.FIREFLY_HOUSEHOLD_TOKEN = "secret-token";
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: {
              id: "44",
              attributes: {
                name: "Cuenta nómina",
                type: "asset",
                currency_code: "COP",
                current_balance: "500000",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const account = await new FireflyClient().createAccount(
      {
        name: "Cuenta nómina",
        type: "checking",
        currency: "COP",
        openingBalance: "500000",
      },
      "household",
      actor.memberId,
    );
    expect(account.id).toBe("44");
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
    expect(JSON.stringify(account)).not.toContain("secret-token");
  });

  it("informa configuración ausente sin intentar una llamada", async () => {
    await expect(
      new FireflyClient().listAssetAccounts("private", actor.memberId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("un libro privado caído no bloquea las cuentas compartidas", async () => {
    const firefly = {
      listAssetAccounts: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: "1",
            name: "Hogar",
            type: "asset",
            currency: "COP",
            currentBalance: "10",
            scope: "household",
          },
        ])
        .mockRejectedValueOnce(new Error("private unavailable")),
      hasToken: vi.fn(() => true),
    };
    const prisma = {
      accountProfile: { findMany: vi.fn(async () => []) },
      pocketFundingLot: { groupBy: vi.fn(async () => []) },
      member: {
        findMany: vi.fn(async () => [
          {
            id: actor.memberId,
            displayName: actor.displayName,
            color: "#123C69",
          },
        ]),
      },
    };
    const accounts = new AccountsService(prisma as never, firefly as never);
    const result = await new AccountsController(accounts).list(actor);
    expect(result.accounts).toHaveLength(1);
    expect(result.connections).toEqual([
      expect.objectContaining({ scope: "household", status: "available" }),
      expect.objectContaining({ scope: "private", status: "unavailable" }),
    ]);
  });
});
