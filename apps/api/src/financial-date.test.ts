import { describe, expect, it } from "vitest";
import { financialDate, financialMonthStart } from "./financial-date.js";
describe("household calendar", () => {
  it("el primero de mes UTC todavía puede pertenecer al mes anterior en Bogotá", () => {
    const now = new Date("2026-10-01T02:00:00Z");
    expect(financialDate(now)).toBe("2026-09-30");
    expect(financialMonthStart(now).toISOString()).toBe(
      "2026-09-01T05:00:00.000Z",
    );
  });
  it("respeta el offset de una zona con horario estacional", () => {
    expect(
      financialMonthStart(
        new Date("2026-07-15T12:00:00Z"),
        "Europe/Madrid",
      ).toISOString(),
    ).toBe("2026-06-30T22:00:00.000Z");
  });
});
