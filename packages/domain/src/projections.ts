import { Decimal } from "decimal.js";
import { decimal, roundMoney, type Currency } from "./money.js";
import type { Frequency } from "./pockets.js";

export interface GoalProjection {
  periods: number;
  contributionPerPeriod: string;
  projectedDate: string;
  lastContribution: string;
  shortfall: string;
}

function addPeriods(date: Date, periods: number, frequency: Frequency): Date {
  const result = new Date(date);
  if (frequency === "weekly")
    result.setUTCDate(result.getUTCDate() + periods * 7);
  if (frequency === "biweekly")
    result.setUTCDate(result.getUTCDate() + periods * 14);
  if (frequency === "monthly") {
    const originalDay = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + periods);
    const lastDay = new Date(
      Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();
    result.setUTCDate(Math.min(originalDay, lastDay));
  }
  return result;
}

function countPeriods(start: Date, end: Date, frequency: Frequency): number {
  if (end <= start) return 0;
  const days = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
  if (frequency === "weekly") return Math.ceil(days / 7);
  if (frequency === "biweekly") return Math.ceil(days / 14);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  return Math.max(1, months + (end.getUTCDate() > start.getUTCDate() ? 1 : 0));
}

export function projectGoalByDate(input: {
  currentAmount: Decimal.Value;
  targetAmount: Decimal.Value;
  startDate: string;
  targetDate: string;
  frequency: Frequency;
  currency: Currency;
}): GoalProjection {
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const targetDate = new Date(`${input.targetDate}T00:00:00.000Z`);
  const remaining = Decimal.max(
    0,
    decimal(input.targetAmount).minus(input.currentAmount),
  );
  const periods = countPeriods(start, targetDate, input.frequency);
  if (periods === 0 && remaining.greaterThan(0))
    throw new Error("La fecha objetivo debe ser futura");
  const contribution = periods === 0 ? new Decimal(0) : remaining.div(periods);
  return {
    periods,
    contributionPerPeriod: roundMoney(contribution, input.currency),
    projectedDate: input.targetDate,
    lastContribution: roundMoney(contribution, input.currency),
    shortfall: "0",
  };
}

export function projectGoalByContribution(input: {
  currentAmount: Decimal.Value;
  targetAmount: Decimal.Value;
  contributionAmount: Decimal.Value;
  startDate: string;
  frequency: Frequency;
  currency: Currency;
}): GoalProjection {
  const remaining = Decimal.max(
    0,
    decimal(input.targetAmount).minus(input.currentAmount),
  );
  const contribution = decimal(input.contributionAmount);
  if (contribution.lessThanOrEqualTo(0))
    throw new Error("El aporte debe ser mayor que cero");
  const periods = remaining.isZero()
    ? 0
    : remaining.div(contribution).ceil().toNumber();
  const last =
    periods <= 1 ? remaining : remaining.minus(contribution.mul(periods - 1));
  return {
    periods,
    contributionPerPeriod: roundMoney(contribution, input.currency),
    projectedDate: addPeriods(
      new Date(`${input.startDate}T00:00:00.000Z`),
      periods,
      input.frequency,
    )
      .toISOString()
      .slice(0, 10),
    lastContribution: roundMoney(Decimal.max(0, last), input.currency),
    shortfall: "0",
  };
}

export function safeDailySpend(input: {
  limit: Decimal.Value;
  spent: Decimal.Value;
  daysRemaining: number;
  currency: Currency;
}): string {
  if (input.daysRemaining <= 0) return "0";
  return roundMoney(
    Decimal.max(0, decimal(input.limit).minus(input.spent)).div(
      input.daysRemaining,
    ),
    input.currency,
  );
}

export function projectCdt(input: {
  principal: Decimal.Value;
  effectiveAnnualRate: Decimal.Value;
  days: number;
  withholdingRate?: Decimal.Value;
  fees?: Decimal.Value;
  currency: Currency;
}) {
  const principal = decimal(input.principal);
  const grossInterest = principal.mul(
    decimal(1)
      .plus(input.effectiveAnnualRate)
      .pow(input.days / 365)
      .minus(1),
  );
  const withholding = grossInterest.mul(input.withholdingRate ?? 0);
  const fees = decimal(input.fees ?? 0);
  const netInterest = grossInterest.minus(withholding).minus(fees);
  return {
    principal: roundMoney(principal, input.currency),
    grossInterest: roundMoney(grossInterest, input.currency),
    withholding: roundMoney(withholding, input.currency),
    fees: roundMoney(fees, input.currency),
    netInterest: roundMoney(netInterest, input.currency),
    maturityAmount: roundMoney(principal.plus(netInterest), input.currency),
  };
}

export function projectInvestment(input: {
  initialAmount: Decimal.Value;
  monthlyContribution: Decimal.Value;
  annualReturn: Decimal.Value;
  annualInflation: Decimal.Value;
  years: number;
  currency: Currency;
}) {
  const months = input.years * 12;
  const monthlyRate = decimal(1)
    .plus(input.annualReturn)
    .pow(1 / 12)
    .minus(1);
  let nominal = decimal(input.initialAmount);
  for (let month = 0; month < months; month += 1) {
    nominal = nominal
      .mul(decimal(1).plus(monthlyRate))
      .plus(input.monthlyContribution);
  }
  const real = nominal.div(
    decimal(1).plus(input.annualInflation).pow(input.years),
  );
  return {
    months,
    contributed: roundMoney(
      decimal(input.initialAmount).plus(
        decimal(input.monthlyContribution).mul(months),
      ),
      input.currency,
    ),
    nominalValue: roundMoney(nominal, input.currency),
    realValue: roundMoney(real, input.currency),
  };
}

export function amortizeDebt(input: {
  principal: Decimal.Value;
  annualRate: Decimal.Value;
  monthlyPayment: Decimal.Value;
  extraPayment?: Decimal.Value;
  monthlyFees?: Decimal.Value;
  currency: Currency;
  maxMonths?: number;
}) {
  const rate = decimal(input.annualRate).div(12);
  const payment = decimal(input.monthlyPayment).plus(input.extraPayment ?? 0);
  const fees = decimal(input.monthlyFees ?? 0);
  let balance = decimal(input.principal);
  let totalInterest = new Decimal(0);
  const schedule: Array<{
    month: number;
    payment: string;
    interest: string;
    principal: string;
    balance: string;
  }> = [];
  const maxMonths = input.maxMonths ?? 600;

  for (
    let month = 1;
    balance.greaterThan(0) && month <= maxMonths;
    month += 1
  ) {
    const interest = balance.mul(rate).plus(fees);
    if (payment.lessThanOrEqualTo(interest))
      throw new Error("La cuota no cubre intereses y cargos");
    const applied = Decimal.min(payment, balance.plus(interest));
    const principalPaid = applied.minus(interest);
    balance = Decimal.max(0, balance.minus(principalPaid));
    totalInterest = totalInterest.plus(interest);
    schedule.push({
      month,
      payment: roundMoney(applied, input.currency),
      interest: roundMoney(interest, input.currency),
      principal: roundMoney(principalPaid, input.currency),
      balance: roundMoney(balance, input.currency),
    });
  }
  if (balance.greaterThan(0))
    throw new Error("La deuda excede el horizonte máximo");
  return {
    months: schedule.length,
    totalInterest: roundMoney(totalInterest, input.currency),
    schedule,
  };
}

export function projectRealEstate(input: {
  propertyPrice: Decimal.Value;
  downPaymentRate: Decimal.Value;
  currentSavings: Decimal.Value;
  monthlySavings: Decimal.Value;
  annualMortgageRate: Decimal.Value;
  mortgageYears: number;
  closingCosts?: Decimal.Value;
  currency: Currency;
}) {
  const price = decimal(input.propertyPrice);
  const downPayment = price
    .mul(input.downPaymentRate)
    .plus(input.closingCosts ?? 0);
  const remainingToSave = Decimal.max(
    0,
    downPayment.minus(input.currentSavings),
  );
  const monthlySavings = decimal(input.monthlySavings);
  if (monthlySavings.lessThanOrEqualTo(0) && remainingToSave.greaterThan(0)) {
    throw new Error("El ahorro mensual debe ser mayor que cero");
  }
  const monthsToDownPayment = remainingToSave.isZero()
    ? 0
    : remainingToSave.div(monthlySavings).ceil().toNumber();
  const mortgagePrincipal = Decimal.max(
    0,
    price.minus(price.mul(input.downPaymentRate)),
  );
  const periods = input.mortgageYears * 12;
  const monthlyRate = decimal(input.annualMortgageRate).div(12);
  const mortgagePayment = monthlyRate.isZero()
    ? mortgagePrincipal.div(periods)
    : mortgagePrincipal
        .mul(monthlyRate)
        .mul(decimal(1).plus(monthlyRate).pow(periods))
        .div(decimal(1).plus(monthlyRate).pow(periods).minus(1));
  return {
    downPayment: roundMoney(downPayment, input.currency),
    remainingToSave: roundMoney(remainingToSave, input.currency),
    monthsToDownPayment,
    mortgagePrincipal: roundMoney(mortgagePrincipal, input.currency),
    estimatedMortgagePayment: roundMoney(mortgagePayment, input.currency),
  };
}
