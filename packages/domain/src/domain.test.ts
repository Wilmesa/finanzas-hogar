import { describe, expect, it } from "vitest";
import {
  canReadPocket,
  previewIncomeAllocation,
  previewExpectedIncomeFunding,
  projectGoalByContribution,
  projectGoalByDate,
  projectRealEstate,
  safeDailySpend,
  planningTimeBucket,
  generateRecurringIncomeDates,
  CreatePocketSchema,
} from "./index.js";

describe("Pocket Engine", () => {
  it("calcula 300 por mes para una meta de 3000 en diez meses", () => {
    expect(
      projectGoalByDate({
        currentAmount: "0",
        targetAmount: "3000",
        startDate: "2026-01-01",
        targetDate: "2026-11-01",
        frequency: "monthly",
        currency: "USD",
      }).contributionPerPeriod,
    ).toBe("300.00");
  });

  it("proyecta doce meses con aporte de 250", () => {
    const result = projectGoalByContribution({
      currentAmount: "0",
      targetAmount: "3000",
      contributionAmount: "250",
      startDate: "2026-01-01",
      frequency: "monthly",
      currency: "USD",
    });
    expect(result.periods).toBe(12);
    expect(result.projectedDate).toBe("2027-01-01");
  });

  it("mantiene fin de mes al proyectar aportes mensuales", () => {
    const result = projectGoalByContribution({
      currentAmount: "0",
      targetAmount: "200",
      contributionAmount: "100",
      startDate: "2027-01-31",
      frequency: "monthly",
      currency: "USD",
    });
    expect(result.projectedDate).toBe("2027-03-31");
  });

  it("oculta un bolsillo privado a otros miembros", () => {
    const pocket = {
      visibility: "private" as const,
      ownerMemberId: "owner",
      householdId: "casa",
    };
    expect(
      canReadPocket(pocket, { memberId: "owner", householdId: "casa" }),
    ).toBe(true);
    expect(
      canReadPocket(pocket, { memberId: "partner", householdId: "casa" }),
    ).toBe(false);
  });

  it.each([
    "daily_spend",
    "sinking_fund",
    "purchase",
    "emergency",
    "debt",
    "investment",
    "real_estate",
    "custom",
  ] as const)(
    "acepta el propósito %s con una política periódica",
    (purpose) => {
      const parsed = CreatePocketSchema.parse({
        name: `Bolsillo ${purpose}`,
        purpose,
        visibility: "household",
        currency: "cop",
        currentAmount: "0",
        policy: { kind: "periodic_spend", limit: "100000", period: "monthly" },
      });
      expect(parsed.currency).toBe("COP");
      expect(parsed.purpose).toBe(purpose);
    },
  );

  it("rechaza límites periódicos vacíos, cero o negativos", () => {
    for (const limit of ["", "0", "-1", "no-es-numero"]) {
      expect(
        CreatePocketSchema.safeParse({
          name: "Vida diaria",
          purpose: "daily_spend",
          currency: "COP",
          policy: { kind: "periodic_spend", limit, period: "monthly" },
        }).success,
      ).toBe(false);
    }
  });

  it("crea un bolsillo sin clasificación y acepta observaciones libres", () => {
    const parsed = CreatePocketSchema.parse({
      name: "Proyecto familiar",
      notes: "Usarlo cuando acordemos la fecha y el importe final.",
      currency: "COP",
      policy: {
        kind: "target_by_contribution",
        targetAmount: "5000000",
        contributionAmount: "300000",
        frequency: "monthly",
      },
    });
    expect(parsed.purpose).toBe("custom");
    expect(parsed.notes).toContain("fecha");
  });

  it("distribuye ingreso por prioridad y remanente", () => {
    const result = previewIncomeAllocation("1000", "USD", [
      { pocketId: "mercado", priority: 1, mode: "fixed", value: "400" },
      { pocketId: "ahorro", priority: 2, mode: "percentage", value: "0.10" },
      { pocketId: "libre", priority: 3, mode: "remainder" },
    ]);
    expect(result.allocations).toEqual([
      { pocketId: "mercado", amount: "400.00" },
      { pocketId: "ahorro", amount: "100.00" },
      { pocketId: "libre", amount: "500.00" },
    ]);
  });

  it("calcula gasto diario seguro", () => {
    expect(
      safeDailySpend({
        limit: "1000",
        spent: "800",
        daysRemaining: 10,
        currency: "USD",
      }),
    ).toBe("20.00");
  });

  it("proyecta cuota inicial y crédito inmobiliario", () => {
    const result = projectRealEstate({
      propertyPrice: "400000000",
      downPaymentRate: "0.30",
      currentSavings: "30000000",
      monthlySavings: "3000000",
      annualMortgageRate: "0.12",
      mortgageYears: 15,
      currency: "COP",
    });
    expect(result.downPayment).toBe("120000000");
    expect(result.monthsToDownPayment).toBe(30);
    expect(Number(result.estimatedMortgagePayment)).toBeGreaterThan(3_000_000);
  });

  it("asigna una prima por cantidades, porcentaje y remanente", () => {
    const result = previewExpectedIncomeFunding({
      incomeAmount: "10000000",
      currency: "COP",
      allocations: [
        {
          targetId: "emergencia",
          mode: "fixed",
          value: "3000000",
          priority: 1,
        },
        {
          targetId: "inversion",
          mode: "percentage",
          value: "0.20",
          priority: 2,
        },
        { targetId: "viaje", mode: "remainder", priority: 3 },
      ],
    });
    expect(result.allocations.map((item) => item.amount)).toEqual([
      "3000000",
      "2000000",
      "5000000",
    ]);
    expect(result.unassignedAmount).toBe("0");
  });

  it("clasifica compromisos por horizonte operativo", () => {
    expect(planningTimeBucket("2026-07-20", "2026-07-20")).toBe("today");
    expect(planningTimeBucket("2026-07-25", "2026-07-20")).toBe("this_week");
    expect(planningTimeBucket("2026-08-15", "2026-07-20")).toBe("next_90_days");
    expect(planningTimeBucket("2027-06-30", "2026-07-20")).toBe("future");
  });

  it("hace visible una sobreasignación antes de aprobar el plan", () => {
    const result = previewExpectedIncomeFunding({
      incomeAmount: "1000",
      currency: "USD",
      allocations: [
        { targetId: "a", mode: "fixed", value: "700", priority: 1 },
        { targetId: "b", mode: "percentage", value: "0.50", priority: 2 },
      ],
    });
    expect(result.overallocatedAmount).toBe("200.00");
    expect(result.unassignedAmount).toBe("0.00");
  });

  it("rechaza dos destinos que intentan consumir el mismo remanente", () => {
    expect(() =>
      previewExpectedIncomeFunding({
        incomeAmount: "1000",
        currency: "USD",
        allocations: [
          { targetId: "a", mode: "remainder", priority: 1 },
          { targetId: "b", mode: "remainder", priority: 2 },
        ],
      }),
    ).toThrow("Solo puede existir una regla de remanente");
  });

  it("genera salarios mensuales conservando el fin de mes", () => {
    expect(
      generateRecurringIncomeDates({
        startDate: "2027-01-31",
        endDate: "2027-04-30",
        recurrence: "monthly",
      }),
    ).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });
});
