import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { ExchangeRatesService } from "./exchange-rates.service.js";
import { PrismaService } from "./prisma.service.js";

const SettingsSchema = z.object({
  trmDailySyncEnabled: z.boolean(),
  openFinanceMode: z.enum(["disabled", "sandbox"]),
});

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  async status(actor: Actor) {
    const [preference, latestTrm] = await Promise.all([
      this.prisma.integrationPreference.findUnique({
        where: { householdId: actor.householdId },
      }),
      this.prisma.exchangeRate.findFirst({
        where: { baseCurrency: "USD", quoteCurrency: "COP" },
        orderBy: [{ effectiveDate: "desc" }, { fetchedAt: "desc" }],
      }),
    ]);
    const sandboxAvailable =
      process.env.OPEN_FINANCE_MOCK_ENABLED === "true" &&
      (process.env.OPEN_FINANCE_MOCK_SECRET?.length ?? 0) >= 32;
    return {
      editable: actor.role === "owner",
      trm: {
        dailySyncEnabled:
          preference?.trmDailySyncEnabled ??
          process.env.TRM_SYNC_ENABLED === "true",
        primarySource: "Superintendencia Financiera de Colombia",
        fallbackSource: "Datos Abiertos Colombia",
        lastSync: latestTrm
          ? {
              rate: latestTrm.rate.toString(),
              effectiveDate: latestTrm.effectiveDate,
              fetchedAt: latestTrm.fetchedAt,
              source: latestTrm.source,
              sourceUrl: latestTrm.sourceUrl,
            }
          : null,
      },
      openFinance: {
        mode: preference?.openFinanceMode ?? "disabled",
        sandboxAvailable,
        providerConnected: false,
        providerName: null,
      },
    };
  }

  async update(raw: unknown, actor: Actor) {
    if (actor.role !== "owner") throw new UnauthorizedException();
    const parsed = SettingsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException("La configuración no es válida");
    }
    if (
      parsed.data.openFinanceMode === "sandbox" &&
      !(
        process.env.OPEN_FINANCE_MOCK_ENABLED === "true" &&
        (process.env.OPEN_FINANCE_MOCK_SECRET?.length ?? 0) >= 32
      )
    ) {
      throw new BadRequestException(
        "El sandbox bancario debe habilitarse primero en el servidor",
      );
    }
    await this.prisma.integrationPreference.upsert({
      where: { householdId: actor.householdId },
      create: {
        householdId: actor.householdId,
        ...parsed.data,
      },
      update: parsed.data,
    });
    return this.status(actor);
  }

  async refreshTrm(actor: Actor) {
    if (actor.role !== "owner") throw new UnauthorizedException();
    const rate = await this.exchangeRates.refreshTrm();
    return {
      rate: rate.rate.toString(),
      effectiveDate: rate.effectiveDate,
      fetchedAt: rate.fetchedAt,
      source: rate.source,
      sourceUrl: rate.sourceUrl,
    };
  }

  async assertMockEnabled(actor: Actor) {
    const preference = await this.prisma.integrationPreference.findUnique({
      where: { householdId: actor.householdId },
    });
    if (preference?.openFinanceMode !== "sandbox") {
      throw new UnauthorizedException(
        "El sandbox bancario no está habilitado para este hogar",
      );
    }
  }
}
