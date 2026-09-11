import { describe, expect, it } from "vitest";
import { canReplayOffline } from "./offline-policy";

describe("offline ownership", () => {
  const item = { memberId: "a", path: "/api/v1/transactions" };
  it("permite solo la sesión del creador con CSRF renovado", () => {
    expect(
      canReplayOffline(item, { householdMemberId: "a", csrfToken: "fresh" }),
    ).toBe(true);
    expect(
      canReplayOffline(item, { householdMemberId: "b", csrfToken: "fresh" }),
    ).toBe(false);
    expect(canReplayOffline(item, { householdMemberId: "a" })).toBe(false);
  });
  it("no reasigna entradas antiguas ni permite enviar a otras rutas", () => {
    expect(
      canReplayOffline(
        { path: item.path },
        { householdMemberId: "a", csrfToken: "fresh" },
      ),
    ).toBe(false);
    expect(
      canReplayOffline(
        { ...item, path: "https://other.invalid" },
        { householdMemberId: "a", csrfToken: "fresh" },
      ),
    ).toBe(false);
  });
});
