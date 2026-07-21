import { Decimal } from "decimal.js";
import { decimal, roundMoney, type Currency } from "./money.js";

export type FundingAllocationMode = "fixed" | "percentage" | "remainder";

export interface FundingAllocationInput {
  targetId: string;
  mode: FundingAllocationMode;
  value?: Decimal.Value;
  priority: number;
}

export interface FundingAllocationResult {
  targetId: string;
  amount: string;
  priority: number;
}

export interface ExpectedIncomeForecast {
  incomeAmount: string;
  allocatedAmount: string;
  unassignedAmount: string;
  overallocatedAmount: string;
  allocations: FundingAllocationResult[];
}

/**
 * Previews a decision without moving real money. Percentages use a 0..1 ratio
 * over the original income; a remainder rule receives what is still unassigned.
 */
export function previewExpectedIncomeFunding(input: {
  incomeAmount: Decimal.Value;
  currency: Currency;
  allocations: FundingAllocationInput[];
}): ExpectedIncomeForecast {
  const income = decimal(input.incomeAmount);
  if (income.lessThanOrEqualTo(0)) {
    throw new Error("El ingreso esperado debe ser mayor que cero");
  }
  const ordered = [...input.allocations].sort(
    (left, right) => left.priority - right.priority,
  );
  let remaining = income;
  let requested = new Decimal(0);
  let remainderRules = 0;
  const allocations = ordered.map((allocation) => {
    let amount: Decimal;
    if (allocation.mode === "fixed") {
      amount = decimal(allocation.value ?? 0);
    } else if (allocation.mode === "percentage") {
      const ratio = decimal(allocation.value ?? 0);
      if (ratio.lessThan(0) || ratio.greaterThan(1)) {
        throw new Error("El porcentaje debe estar entre 0 y 1");
      }
      amount = income.mul(ratio);
    } else {
      remainderRules += 1;
      if (remainderRules > 1) {
        throw new Error("Solo puede existir una regla de remanente");
      }
      amount = Decimal.max(0, remaining);
    }
    if (amount.lessThan(0)) {
      throw new Error("Una asignación no puede ser negativa");
    }
    requested = requested.plus(amount);
    remaining = remaining.minus(amount);
    return {
      targetId: allocation.targetId,
      amount: roundMoney(amount, input.currency),
      priority: allocation.priority,
    };
  });
  return {
    incomeAmount: roundMoney(income, input.currency),
    allocatedAmount: roundMoney(requested, input.currency),
    unassignedAmount: roundMoney(Decimal.max(0, remaining), input.currency),
    overallocatedAmount: roundMoney(
      Decimal.max(0, requested.minus(income)),
      input.currency,
    ),
    allocations,
  };
}

export type PlanningTimeBucket =
  "today" | "this_week" | "this_month" | "next_90_days" | "future";

export type IncomeRecurrenceValue =
  | "once"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "custom";

function addRecurringPeriod(
  start: Date,
  index: number,
  recurrence: IncomeRecurrenceValue,
): Date {
  const result = new Date(start);
  if (recurrence === "weekly" || recurrence === "biweekly") {
    result.setUTCDate(
      result.getUTCDate() + index * (recurrence === "weekly" ? 7 : 14),
    );
    return result;
  }
  const months =
    recurrence === "monthly"
      ? index
      : recurrence === "quarterly"
        ? index * 3
        : recurrence === "semiannual"
          ? index * 6
          : recurrence === "annual"
            ? index * 12
            : 0;
  const anchorDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(anchorDay, lastDay));
  return result;
}

export function generateRecurringIncomeDates(input: {
  startDate: string;
  endDate?: string;
  recurrence: IncomeRecurrenceValue;
  maxOccurrences?: number;
}): string[] {
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const end = new Date(`${input.endDate ?? input.startDate}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  ) {
    throw new Error("El rango de recurrencia no es válido");
  }
  if (input.recurrence === "once" || input.recurrence === "custom") {
    return [input.startDate];
  }
  const maximum = Math.min(120, Math.max(1, input.maxOccurrences ?? 120));
  const dates: string[] = [];
  for (let index = 0; index < maximum; index += 1) {
    const current = addRecurringPeriod(start, index, input.recurrence);
    if (current > end) break;
    dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

export function planningTimeBucket(
  expectedDate: string,
  today: string,
): PlanningTimeBucket {
  const start = new Date(`${today}T00:00:00.000Z`);
  const expected = new Date(`${expectedDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(expected.getTime())) {
    throw new Error("La fecha de planificación no es válida");
  }
  const days = Math.floor((expected.getTime() - start.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days <= 7) return "this_week";
  if (
    expected.getUTCFullYear() === start.getUTCFullYear() &&
    expected.getUTCMonth() === start.getUTCMonth()
  ) {
    return "this_month";
  }
  if (days <= 90) return "next_90_days";
  return "future";
}
