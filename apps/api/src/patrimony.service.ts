import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { ExchangeRatesService } from "./exchange-rates.service.js";
import { PrismaService } from "./prisma.service.js";

const money = z
  .string()
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0);
const optionalMoney = money.optional();
const dateOnly = z.iso.date();
const sourceUrl = z
  .url()
  .max(2048)
  .refine((value) => ["https:", "http:"].includes(new URL(value).protocol));
const visibility = z.enum(["household", "private"]);
const investmentInput = z.object({
  kind: z.enum(["cdt", "stock", "fund", "dollar_app", "other"]),
  name: z.string().trim().min(1).max(120),
  institution: z.string().trim().max(120).optional(),
  visibility: visibility.default("household"),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  principal: money,
  openedAt: dateOnly,
  maturityDate: dateOnly.optional(),
  annualRate: optionalMoney,
  expectedGrossGain: optionalMoney,
  feesAndTaxes: optionalMoney,
  expectedNetGain: optionalMoney,
  ticker: z.string().trim().max(20).optional(),
  units: optionalMoney,
  purchasePrice: optionalMoney,
  currentPrice: optionalMoney,
  priceAsOf: z.iso.datetime().optional(),
  sourceUrl: sourceUrl.optional(),
  pocketId: z.string().uuid().optional(),
});
const propertyInput = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  visibility: visibility.default("household"),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  purchaseValue: optionalMoney,
  currentEstimatedValue: money,
  purchaseDate: dateOnly.optional(),
  locationSector: z.string().trim().max(160).optional(),
  annualAppreciation: optionalMoney,
  lastValuationAt: dateOnly,
  notes: z.string().trim().max(1000).optional(),
});

@Injectable()
export class PatrimonyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  private visible(actor: Actor) {
    return {
      householdId: actor.householdId,
      OR: [
        { visibility: "household" as const },
        { ownerMemberId: actor.memberId },
      ],
    };
  }

  async overview(actor: Actor) {
    const [investments, properties, history] = await Promise.all([
      this.prisma.investmentPosition.findMany({
        where: { ...this.visible(actor), status: "active" },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.propertyAsset.findMany({
        where: { ...this.visible(actor), status: "active" },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.netWorthSnapshot.findMany({
        where: { householdId: actor.householdId },
        orderBy: { recordedAt: "asc" },
        take: 36,
      }),
    ]);
    return { investments, properties, history };
  }

  createInvestment(raw: unknown, actor: Actor) {
    const parsed = investmentInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    return this.prisma.investmentPosition.create({
      data: {
        householdId: actor.householdId,
        ownerMemberId: actor.memberId,
        kind: input.kind,
        name: input.name,
        institution: input.institution ?? null,
        visibility: input.visibility,
        currency: input.currency,
        pocketId: input.pocketId ?? null,
        principal: new Prisma.Decimal(input.principal),
        openedAt: new Date(`${input.openedAt}T00:00:00Z`),
        maturityDate: input.maturityDate
          ? new Date(`${input.maturityDate}T00:00:00Z`)
          : null,
        annualRate: input.annualRate
          ? new Prisma.Decimal(input.annualRate)
          : null,
        expectedGrossGain: input.expectedGrossGain
          ? new Prisma.Decimal(input.expectedGrossGain)
          : null,
        feesAndTaxes: input.feesAndTaxes
          ? new Prisma.Decimal(input.feesAndTaxes)
          : null,
        expectedNetGain: input.expectedNetGain
          ? new Prisma.Decimal(input.expectedNetGain)
          : null,
        units: input.units ? new Prisma.Decimal(input.units) : null,
        purchasePrice: input.purchasePrice
          ? new Prisma.Decimal(input.purchasePrice)
          : null,
        currentPrice: input.currentPrice
          ? new Prisma.Decimal(input.currentPrice)
          : null,
        priceAsOf: input.priceAsOf ? new Date(input.priceAsOf) : null,
        ticker: input.ticker ?? null,
        sourceUrl: input.sourceUrl ?? null,
      },
    });
  }

  async updateInvestment(id: string, raw: unknown, actor: Actor) {
    await this.investment(id, actor);
    const parsed = investmentInput
      .partial()
      .extend({ status: z.enum(["active", "closed", "archived"]).optional() })
      .safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    const data: Prisma.InvestmentPositionUncheckedUpdateInput = {
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.institution !== undefined
        ? { institution: input.institution }
        : {}),
      ...(input.visibility !== undefined
        ? { visibility: input.visibility }
        : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.pocketId !== undefined ? { pocketId: input.pocketId } : {}),
      ...(input.ticker !== undefined ? { ticker: input.ticker } : {}),
      ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.principal !== undefined
        ? { principal: new Prisma.Decimal(input.principal) }
        : {}),
      ...(input.openedAt !== undefined
        ? { openedAt: new Date(`${input.openedAt}T00:00:00Z`) }
        : {}),
      ...(input.maturityDate !== undefined
        ? { maturityDate: new Date(`${input.maturityDate}T00:00:00Z`) }
        : {}),
      ...(input.annualRate !== undefined
        ? { annualRate: new Prisma.Decimal(input.annualRate) }
        : {}),
      ...(input.expectedGrossGain !== undefined
        ? { expectedGrossGain: new Prisma.Decimal(input.expectedGrossGain) }
        : {}),
      ...(input.feesAndTaxes !== undefined
        ? { feesAndTaxes: new Prisma.Decimal(input.feesAndTaxes) }
        : {}),
      ...(input.expectedNetGain !== undefined
        ? { expectedNetGain: new Prisma.Decimal(input.expectedNetGain) }
        : {}),
      ...(input.units !== undefined
        ? { units: new Prisma.Decimal(input.units) }
        : {}),
      ...(input.purchasePrice !== undefined
        ? { purchasePrice: new Prisma.Decimal(input.purchasePrice) }
        : {}),
      ...(input.currentPrice !== undefined
        ? { currentPrice: new Prisma.Decimal(input.currentPrice) }
        : {}),
      ...(input.priceAsOf !== undefined
        ? { priceAsOf: new Date(input.priceAsOf) }
        : {}),
    };
    return this.prisma.investmentPosition.update({ where: { id }, data });
  }

  createProperty(raw: unknown, actor: Actor) {
    const parsed = propertyInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    return this.prisma.propertyAsset.create({
      data: {
        householdId: actor.householdId,
        ownerMemberId: actor.memberId,
        name: input.name,
        type: input.type,
        visibility: input.visibility,
        currency: input.currency,
        locationSector: input.locationSector ?? null,
        notes: input.notes ?? null,
        purchaseValue: input.purchaseValue
          ? new Prisma.Decimal(input.purchaseValue)
          : null,
        currentEstimatedValue: new Prisma.Decimal(input.currentEstimatedValue),
        purchaseDate: input.purchaseDate
          ? new Date(`${input.purchaseDate}T00:00:00Z`)
          : null,
        annualAppreciation: input.annualAppreciation
          ? new Prisma.Decimal(input.annualAppreciation)
          : null,
        lastValuationAt: new Date(`${input.lastValuationAt}T00:00:00Z`),
      },
    });
  }

  async updateProperty(id: string, raw: unknown, actor: Actor) {
    const existing = await this.prisma.propertyAsset.findFirst({
      where: { id, ...this.visible(actor) },
    });
    if (!existing) throw new NotFoundException();
    const parsed = propertyInput
      .partial()
      .extend({ status: z.enum(["active", "sold", "archived"]).optional() })
      .safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    const data: Prisma.PropertyAssetUncheckedUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.visibility !== undefined
        ? { visibility: input.visibility }
        : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.locationSector !== undefined
        ? { locationSector: input.locationSector }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.purchaseValue !== undefined
        ? { purchaseValue: new Prisma.Decimal(input.purchaseValue) }
        : {}),
      ...(input.currentEstimatedValue !== undefined
        ? {
            currentEstimatedValue: new Prisma.Decimal(
              input.currentEstimatedValue,
            ),
          }
        : {}),
      ...(input.purchaseDate !== undefined
        ? { purchaseDate: new Date(`${input.purchaseDate}T00:00:00Z`) }
        : {}),
      ...(input.annualAppreciation !== undefined
        ? { annualAppreciation: new Prisma.Decimal(input.annualAppreciation) }
        : {}),
      ...(input.lastValuationAt !== undefined
        ? { lastValuationAt: new Date(`${input.lastValuationAt}T00:00:00Z`) }
        : {}),
    };
    return this.prisma.propertyAsset.update({ where: { id }, data });
  }

  async snapshot(raw: unknown, actor: Actor) {
    const parsed = z
      .object({
        recordedAt: dateOnly,
        currency: z
          .string()
          .length(3)
          .transform((value) => value.toUpperCase()),
        assets: money.optional(),
        liabilities: money.optional(),
        components: z
          .array(
            z.object({
              id: z.string().min(1),
              kind: z.enum(["asset", "liability"]),
              amount: money,
              currency: z
                .string()
                .length(3)
                .transform((value) => value.toUpperCase()),
              source: z.string().min(1).max(120),
            }),
          )
          .optional(),
      })
      .refine(
        (value) =>
          Boolean(value.components?.length) ||
          (value.assets !== undefined && value.liabilities !== undefined),
        "Envía activos y pasivos o una lista de componentes",
      )
      .safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const rates: Record<string, string> = {
      [`${parsed.data.currency}/${parsed.data.currency}`]: "1",
    };
    let assets = new Prisma.Decimal(parsed.data.assets ?? 0);
    let liabilities = new Prisma.Decimal(parsed.data.liabilities ?? 0);
    if (parsed.data.components?.length) {
      assets = new Prisma.Decimal(0);
      liabilities = new Prisma.Decimal(0);
      for (const component of parsed.data.components) {
        const exchangeRate = await this.exchangeRates.rate(
          component.currency,
          parsed.data.currency,
          parsed.data.recordedAt,
        );
        rates[`${component.currency}/${parsed.data.currency}`] =
          exchangeRate.rate.toString();
        const converted = new Prisma.Decimal(component.amount).mul(
          exchangeRate.rate,
        );
        if (component.kind === "asset") assets = assets.plus(converted);
        else liabilities = liabilities.plus(converted);
      }
    }
    try {
      return await this.prisma.netWorthSnapshot.create({
        data: {
          householdId: actor.householdId,
          recordedAt: new Date(`${parsed.data.recordedAt}T00:00:00Z`),
          currency: parsed.data.currency,
          assets,
          liabilities,
          netWorth: assets.minus(liabilities),
          exchangeRates: rates,
          components: (parsed.data.components ?? {
            assets: parsed.data.assets,
            liabilities: parsed.data.liabilities,
          }) as Prisma.InputJsonValue,
          source: parsed.data.components?.length
            ? "calculated_with_exchange_rates"
            : "manual",
        },
      });
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === "P2002"
      ) {
        throw new ConflictException(
          "Ya existe un snapshot para esa fecha y moneda. Los snapshots históricos son inmutables",
        );
      }
      throw cause;
    }
  }

  private async investment(id: string, actor: Actor) {
    const value = await this.prisma.investmentPosition.findFirst({
      where: { id, ...this.visible(actor) },
    });
    if (!value) throw new NotFoundException();
    return value;
  }
}
