import { Decimal } from "decimal.js";
import { decimal, roundMoney, type Currency } from "./money.js";

export interface AllocationRule {
  pocketId: string;
  priority: number;
  mode: "fixed" | "percentage" | "remainder";
  value?: string;
  cap?: string;
  currentAmount?: string;
}

export function previewIncomeAllocation(
  income: string,
  currency: Currency,
  rules: AllocationRule[],
) {
  let remaining = decimal(income);
  const allocations: Array<{ pocketId: string; amount: string }> = [];
  let remainderRule: AllocationRule | undefined;

  for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
    if (rule.mode === "remainder") {
      if (remainderRule)
        throw new Error("Solo puede existir una regla de remanente");
      remainderRule = rule;
      continue;
    }
    const requested =
      rule.mode === "fixed"
        ? decimal(rule.value ?? 0)
        : decimal(income).mul(decimal(rule.value ?? 0));
    const capacity = rule.cap
      ? Decimal.max(0, decimal(rule.cap).minus(rule.currentAmount ?? 0))
      : requested;
    const amount = Decimal.min(remaining, requested, capacity);
    allocations.push({
      pocketId: rule.pocketId,
      amount: roundMoney(amount, currency),
    });
    remaining = remaining.minus(amount);
  }

  if (remainderRule && remaining.greaterThan(0)) {
    allocations.push({
      pocketId: remainderRule.pocketId,
      amount: roundMoney(remaining, currency),
    });
    remaining = new Decimal(0);
  }

  return { allocations, unallocated: roundMoney(remaining, currency) };
}
