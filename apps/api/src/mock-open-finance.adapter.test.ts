import { afterEach, describe, expect, it } from "vitest";
import { MockOpenFinanceAdapter } from "./mock-open-finance.adapter.js";

afterEach(() => {
  delete process.env.OPEN_FINANCE_MOCK_ENABLED;
  delete process.env.OPEN_FINANCE_MOCK_SECRET;
});

describe("MockOpenFinanceAdapter", () => {
  it("verifica HMAC y normaliza las fases pending y posted", async () => {
    process.env.OPEN_FINANCE_MOCK_ENABLED = "true";
    process.env.OPEN_FINANCE_MOCK_SECRET = "s".repeat(48);
    const adapter = new MockOpenFinanceAdapter();
    const payload = {
      batchId: "daily-2026-07-28",
      phase: "pending",
      transactions: [
        {
          logicalId: "coffee-1",
          type: "withdrawal",
          amount: "12500",
          currency: "cop",
          merchant: "Café Bogotá",
          occurredAt: "2026-07-28T12:00:00.000Z",
          sourceAccountId: "asset-1",
        },
      ],
    };
    const signature = adapter.sign(payload);

    expect(
      adapter.verifyWebhook(
        { "x-okle-open-finance-signature": signature },
        JSON.stringify(payload),
      ),
    ).toBe(true);
    await expect(adapter.normalize(payload)).resolves.toEqual([
      expect.objectContaining({
        provider: "mock-sandbox",
        externalId: "daily-2026-07-28:coffee-1:pending",
        status: "pending",
        currency: "COP",
      }),
    ]);
  });

  it("rechaza firmas alteradas o sandbox desactivado", () => {
    process.env.OPEN_FINANCE_MOCK_ENABLED = "true";
    process.env.OPEN_FINANCE_MOCK_SECRET = "s".repeat(48);
    const adapter = new MockOpenFinanceAdapter();
    expect(
      adapter.verifyWebhook(
        { "x-okle-open-finance-signature": "0".repeat(64) },
        "{}",
      ),
    ).toBe(false);
    process.env.OPEN_FINANCE_MOCK_ENABLED = "false";
    expect(
      adapter.verifyWebhook(
        { "x-okle-open-finance-signature": adapter.sign({}) },
        "{}",
      ),
    ).toBe(false);
  });
});
