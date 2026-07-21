import { Decimal } from "decimal.js";

Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });

export type Currency = "COP" | "USD" | "EUR" | (string & {});

export interface Money {
  amount: string;
  currency: Currency;
}

export function decimal(value: Decimal.Value): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error("El valor monetario debe ser finito");
  return result;
}

export function monetaryScale(currency: Currency): number {
  return currency === "COP" ? 0 : 2;
}

export function roundMoney(value: Decimal.Value, currency: Currency): string {
  return decimal(value).toFixed(monetaryScale(currency));
}

export function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(
      `No se pueden combinar ${left.currency} y ${right.currency} sin una tasa explícita`,
    );
  }
}
