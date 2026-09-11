import { describe, expect, it } from "vitest";
import type { TransactionView } from "./types";
import { spendingAnalysis } from "./spending-analysis";
describe("spendingAnalysis", () => {
  it("separa monedas, excluye pendientes/reversiones y no cuenta transferencias como gastos", () => {
    const expense = {
      kind: "expense",
      currency: "COP",
      amount: 100,
      category: "Mercado",
      payer: "A",
      syncStatus: "synchronized",
    } as TransactionView;
    const rows: TransactionView[] = [
      expense,
      { ...expense, payer: "B", amount: 50 },
      { ...expense, currency: "USD", amount: 5 },
      { ...expense, syncStatus: "queued" },
      { ...expense, reversed: true },
      { ...expense, isReversal: true },
      { ...expense, kind: "transfer" },
      { ...expense, kind: "income" },
      { ...expense, syncStatus: "failed" },
    ];
    expect(spendingAnalysis(rows, "COP")).toEqual({
      total: 150,
      categories: [["Mercado", 150]],
      payers: [
        ["A", 100],
        ["B", 50],
      ],
    });
    expect(spendingAnalysis(rows, "USD").total).toBe(5);
    expect(spendingAnalysis(rows, "EUR").total).toBe(0);
  });
});
