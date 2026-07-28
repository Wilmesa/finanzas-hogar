import { afterEach, describe, expect, it, vi } from "vitest";
import { ExchangeRatesService } from "./exchange-rates.service.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRM_PRIMARY_URL;
  delete process.env.TRM_FALLBACK_URL;
});

function prismaMock() {
  return {
    exchangeRate: {
      upsert: vi.fn(async ({ create }) => ({ id: "rate-1", ...create })),
    },
  };
}

describe("ExchangeRatesService", () => {
  it("consulta primero el Web Service SOAP de la SFC", async () => {
    process.env.TRM_PRIMARY_URL = "https://sfc.test/trm";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        "<return><validityFrom>2026-07-28T00:00:00-05:00</validityFrom><value>3205.8</value><success>true</success></return>",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const prisma = prismaMock();
    const service = new ExchangeRatesService(prisma as never);

    const result = await service.refreshTrm("2026-07-28");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sfc.test/trm",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.source).toContain("Web Service TRM");
    expect(result.rate.toString()).toBe("3205.8");
  });

  it("usa Datos Abiertos únicamente si la fuente SOAP falla", async () => {
    process.env.TRM_PRIMARY_URL = "https://sfc.test/trm";
    process.env.TRM_FALLBACK_URL = "https://fallback.test/trm";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            valor: "3210.55",
            vigenciadesde: "2026-07-28T00:00:00.000",
          },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);
    const prisma = prismaMock();
    const service = new ExchangeRatesService(prisma as never);

    const result = await service.refreshTrm("2026-07-28");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.source).toContain("fallback");
    expect(result.rate.toString()).toBe("3210.55");
  });
});
