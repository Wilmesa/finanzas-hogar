import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({
  authMode: () => "keycloak",
  getAccessToken: async () => null,
  getCsrfToken: () => null,
}));

import { apiRequest } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("apiRequest", () => {
  it("no declara JSON en un DELETE sin cuerpo", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ archived: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest("/v1/planning/income-sources/source-1", {
      method: "DELETE",
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("declara JSON cuando sí envía un cuerpo serializado", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "pocket-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest("/v1/pockets", {
      method: "POST",
      body: JSON.stringify({ name: "Proyecto" }),
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
