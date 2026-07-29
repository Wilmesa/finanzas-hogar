import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  amortizeDebt,
  previewIncomeAllocation,
  projectCdt,
  projectGoalByContribution,
  projectGoalByDate,
  projectInvestment,
  projectRealEstate,
  safeDailySpend,
} from "@finanzas/domain";
import { CurrentActor, type Actor } from "./auth.js";
import { AiCfoClient } from "./ai-cfo.client.js";
import { PocketsService } from "./pockets.service.js";
import { PrismaService } from "./prisma.service.js";
import { NewsService } from "./news.service.js";
import { FireflyClient } from "./firefly.client.js";
import { PlanningService } from "./planning.service.js";
import { RemindersService } from "./reminders.service.js";
import { HouseholdService } from "./household.service.js";
import { HouseholdAccessService } from "./household-access.service.js";
import { IntegrationsService } from "./integrations.service.js";
import { AccountsService } from "./accounts.service.js";
import { CalendarService } from "./calendar.service.js";
import { CategoriesService } from "./categories.service.js";
import { PaymentsService } from "./payments.service.js";
import { PatrimonyService } from "./patrimony.service.js";
import { ExchangeRatesService } from "./exchange-rates.service.js";
import { IngestionService } from "./ingestion.service.js";
import { MockOpenFinanceAdapter } from "./mock-open-finance.adapter.js";
import { SimulationsService } from "./simulations.service.js";
import { TransactionRulesService } from "./transaction-rules.service.js";
import {
  TransactionsService,
  type CreateTransactionInput,
} from "./transactions.service.js";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return {
      status: "ok",
      service: "finanzas-api",
      timestamp: new Date().toISOString(),
    };
  }
}

@Controller("v1")
export class HouseholdController {
  constructor(
    private readonly households: HouseholdService,
    private readonly householdAccess: HouseholdAccessService,
  ) {}

  @Get("household")
  household(@CurrentActor() actor: Actor) {
    return this.households.get(actor);
  }

  @Patch("household")
  updateHousehold(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.households.updateHousehold(
      actor,
      body as { name?: string; baseCurrency?: string; timezone?: string },
    );
  }

  @Patch("profile")
  updateProfile(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.households.updateProfile(
      actor,
      body as { displayName?: string; avatar?: string | null; color?: string },
    );
  }

  @Patch("profile/ui-preferences")
  updateUiPreferences(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.households.updateUiPreferences(actor, body);
  }

  @Get("onboarding/status")
  onboarding(@CurrentActor() actor: Actor) {
    return this.households.onboarding(actor);
  }

  @Post("onboarding/complete")
  complete(@CurrentActor() actor: Actor) {
    return this.households.completeOnboarding(actor);
  }

  @Post("household/invitations")
  invite(@CurrentActor() actor: Actor) {
    return this.householdAccess.createInvitation(actor);
  }
}

@Controller("v1/pockets")
export class PocketsController {
  constructor(private readonly pockets: PocketsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.pockets.list(actor);
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.pockets.create(body, actor);
  }

  @Get(":id")
  find(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.pockets.find(id, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.pockets.update(id, body, actor);
  }

  @Delete(":id")
  archive(
    @Param("id") id: string,
    @Body()
    body: {
      disposition?: "transfer" | "release";
      destinationPocketId?: string;
    },
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.pockets.archive(id, body, key ?? "", actor);
  }

  @Get(":id/projection")
  project(
    @Param("id") id: string,
    @Query("startDate") startDate: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.pockets.project(
      id,
      actor,
      startDate ?? new Date().toISOString().slice(0, 10),
    );
  }

  @Post(":id/allocate")
  allocate(
    @Param("id") id: string,
    @Body()
    body: {
      amount?: string;
      sourceAccountId?: string;
      sourceLedgerScope?: "household" | "private";
      mode?: "account" | "initial_adjustment" | "correction";
      reason?: string;
    },
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    if (!key) throw new BadRequestException("Idempotency-Key es obligatorio");
    return this.pockets.allocate(id, body, key, actor);
  }

  @Post(":id/release")
  release(
    @Param("id") id: string,
    @Body()
    body: {
      amount?: string;
      targetAccountId?: string;
      targetLedgerScope?: "household" | "private";
    },
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.pockets.release(id, body, key ?? "", actor);
  }

  @Post(":id/transfer")
  transfer(
    @Param("id") id: string,
    @Body() body: { destinationPocketId?: string; amount?: string },
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.pockets.transfer(id, body, key ?? "", actor);
  }

  @Put(":id/account")
  linkAccount(
    @Param("id") id: string,
    @Body()
    body: {
      accountId?: string;
      ledgerScope?: "household" | "private";
      version?: number;
    },
    @CurrentActor() actor: Actor,
  ) {
    return this.pockets.linkAccount(id, body, actor);
  }

  @Post(":id/delete-mistake")
  deleteCreatedByMistake(
    @Param("id") id: string,
    @Body() body: { confirmation?: string; reason?: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.pockets.deleteCreatedByMistake(id, body, actor);
  }
}

@Controller("v1/payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.payments.list(actor);
  }

  @Get("due-count")
  dueCount(@CurrentActor() actor: Actor) {
    return this.payments.dueCount(actor);
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.payments.create(body, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.payments.update(id, body, actor);
  }

  @Delete(":id")
  archive(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.payments.archive(id, actor);
  }

  @Post(":id/occurrences")
  addOccurrence(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.payments.addOccurrence(id, body, actor);
  }

  @Post("occurrences/:id/paid")
  markPaid(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.payments.markPaid(id, body, key ?? "", actor);
  }
}

@Controller("v1/patrimony")
export class PatrimonyController {
  constructor(private readonly patrimony: PatrimonyService) {}
  @Get() overview(@CurrentActor() actor: Actor) {
    return this.patrimony.overview(actor);
  }
  @Post("investments") createInvestment(
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.patrimony.createInvestment(body, actor);
  }
  @Patch("investments/:id") updateInvestment(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.patrimony.updateInvestment(id, body, actor);
  }
  @Post("properties") createProperty(
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.patrimony.createProperty(body, actor);
  }
  @Patch("properties/:id") updateProperty(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.patrimony.updateProperty(id, body, actor);
  }
  @Post("snapshots") snapshot(
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.patrimony.snapshot(body, actor);
  }
}

@Controller("v1/projections")
export class ProjectionsController {
  @Post("savings/by-date")
  byDate(@Body() body: Parameters<typeof projectGoalByDate>[0]) {
    return projectGoalByDate(body);
  }

  @Post("savings/by-contribution")
  byContribution(
    @Body() body: Parameters<typeof projectGoalByContribution>[0],
  ) {
    return projectGoalByContribution(body);
  }

  @Post("cdt")
  cdt(@Body() body: Parameters<typeof projectCdt>[0]) {
    return projectCdt(body);
  }

  @Post("debt")
  debt(@Body() body: Parameters<typeof amortizeDebt>[0]) {
    return amortizeDebt(body);
  }

  @Post("investment")
  investment(@Body() body: Parameters<typeof projectInvestment>[0]) {
    return projectInvestment(body);
  }

  @Post("real-estate")
  realEstate(@Body() body: Parameters<typeof projectRealEstate>[0]) {
    return projectRealEstate(body);
  }
}

@Controller("v1/simulations")
export class SimulationsController {
  constructor(private readonly simulations: SimulationsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.simulations.list(actor);
  }

  @Post()
  save(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.simulations.save(body, actor);
  }

  @Post(":id/convert")
  convert(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.simulations.convert(id, body, actor);
  }

  @Delete(":id")
  archive(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.simulations.archive(id, actor);
  }
}

@Controller("v1/accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.accounts.list(actor);
  }

  private scope(value: string): "household" | "private" {
    if (value !== "household" && value !== "private") {
      throw new BadRequestException("El alcance de cuenta no es válido");
    }
    return value;
  }

  @Post()
  create(
    @Body()
    body: {
      name?: string;
      type?:
        | "cash"
        | "checking"
        | "savings"
        | "digital_wallet"
        | "credit_card"
        | "investment"
        | "other_asset"
        | "liability";
      currency?: string;
      scope?: string;
      openingBalance?: string;
      openingBalanceDate?: string;
      ownerMemberId?: string | null;
      isPrimary?: boolean;
      icon?: string;
      color?: string;
    },
    @CurrentActor() actor: Actor,
  ) {
    if (!body.name || !body.type || !body.currency || !body.scope) {
      throw new BadRequestException(
        "Nombre, tipo, moneda y alcance son obligatorios",
      );
    }
    return this.accounts.create(
      {
        name: body.name,
        type: body.type,
        currency: body.currency,
        scope: this.scope(body.scope),
        ...(body.ownerMemberId !== undefined
          ? { ownerMemberId: body.ownerMemberId }
          : {}),
        ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.openingBalance !== undefined
          ? { openingBalance: body.openingBalance }
          : {}),
        ...(body.openingBalanceDate
          ? { openingBalanceDate: body.openingBalanceDate }
          : {}),
      },
      actor,
    );
  }

  @Patch(":scope/:id")
  update(
    @Param("scope") scope: string,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      currency?: string;
      ownerMemberId?: string | null;
      isPrimary?: boolean;
      icon?: string;
      color?: string;
    },
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.update(id, this.scope(scope), body, actor);
  }

  @Delete(":scope/:id")
  archive(
    @Param("scope") scope: string,
    @Param("id") id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.archive(id, this.scope(scope), actor);
  }

  @Post(":scope/test")
  test(@Param("scope") scope: string, @CurrentActor() actor: Actor) {
    return this.accounts.test(this.scope(scope), actor);
  }
}

@Controller("v1/calendar")
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  calendar(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    const now = new Date();
    const fallbackFrom = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const fallbackTo = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);
    return this.calendarService.calendar(
      actor,
      from ?? fallbackFrom,
      to ?? fallbackTo,
    );
  }
}

@Controller("v1/notifications")
export class NotificationsController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.calendarService.listNotifications(actor);
  }

  @Post("refresh")
  refresh(@CurrentActor() actor: Actor) {
    return this.calendarService.refreshNotifications(actor);
  }

  @Patch(":id/read")
  read(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.calendarService.readNotification(id, actor);
  }
}

@Controller("v1/planning")
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get()
  overview(@CurrentActor() actor: Actor, @Query("today") today?: string) {
    const bogotaToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return this.planning.overview(actor, today ?? bogotaToday);
  }

  @Post("income-sources")
  createSource(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.planning.createSource(body, actor);
  }

  @Patch("income-sources/:id")
  updateSource(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.planning.updateSource(id, body, actor);
  }

  @Delete("income-sources/:id")
  archiveSource(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.planning.archiveSource(id, actor);
  }

  @Post("expected-incomes")
  createExpectedIncome(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.planning.createExpectedIncome(body, actor);
  }

  @Patch("expected-incomes/:id")
  updateExpectedIncome(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.planning.updateExpectedIncome(id, body, actor);
  }

  @Delete("expected-incomes/:id")
  cancelExpectedIncome(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.planning.cancelExpectedIncome(id, actor);
  }

  @Post("plans")
  createPlan(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.planning.createPlan(body, actor);
  }

  @Patch("plans/:id")
  revisePlan(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.planning.revisePlan(id, body, actor);
  }

  @Delete("plans/:id")
  archivePlan(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.planning.archivePlan(id, actor);
  }

  @Post("plans/:id/execute")
  executePlan(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.planning.executePlan(id, body, key ?? "", actor);
  }

  @Post("expected-incomes/:id/receive")
  receiveExpectedIncome(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.planning.receiveExpectedIncome(id, body, actor);
  }

  @Post("allocations/:id/execute")
  executeAllocation(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.planning.executeAllocation(id, body, key ?? "", actor);
  }

  @Get("plans/:id/history")
  history(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.planning.history(id, actor);
  }
}

@Controller("v1/income-allocation-rules")
export class AllocationController {
  @Post("preview")
  preview(
    @Body()
    body: {
      income: string;
      currency: string;
      rules: Parameters<typeof previewIncomeAllocation>[2];
    },
  ) {
    return previewIncomeAllocation(body.income, body.currency, body.rules);
  }
}

@Controller("v1/transactions")
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.transactions.list(actor);
  }

  @Post()
  create(
    @Body() body: CreateTransactionInput,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("x-okle-offline-sync") offlineSync: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.transactions.create(
      body,
      key ?? "",
      actor,
      offlineSync === "true"
        ? { origin: "OFFLINE_SYNC", reviewStatus: "REVIEWED" }
        : undefined,
    );
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.transactions.update(id, body, actor);
  }

  @Post(":id/reverse")
  reverse(
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.transactions.reverse(id, key ?? "", actor);
  }
}

@Controller("v1/review")
export class ReviewController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.transactions.reviewQueue(actor);
  }

  @Patch(":id")
  review(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.transactions.review(id, body, key ?? "", actor);
  }
}

@Controller("v1/security")
export class SecurityController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post("private-metadata/rotate")
  rotatePrivateMetadata(
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.transactions.rotatePrivateMetadata(key ?? "", actor);
  }
}

@Controller("v1/transaction-rules")
export class TransactionRulesController {
  constructor(private readonly rules: TransactionRulesService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.rules.list(actor);
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.rules.create(body, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.rules.update(id, body, actor);
  }

  @Delete(":id")
  archive(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.rules.archive(id, actor);
  }
}

@Controller("v1/ingestion")
export class IngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly mockOpenFinance: MockOpenFinanceAdapter,
    private readonly integrations: IntegrationsService,
  ) {}

  @Post("transactions")
  ingest(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.ingestion.ingest(body, actor);
  }

  @Post("mock-sandbox")
  async ingestMock(
    @Body() body: unknown,
    @Headers("x-okle-open-finance-signature") signature: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    await this.integrations.assertMockEnabled(actor);
    return this.ingestion.ingestFromProvider(
      this.mockOpenFinance,
      body,
      {
        "x-okle-open-finance-signature": signature ?? "",
      },
      actor,
    );
  }
}

@Controller("v1/integrations")
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  status(@CurrentActor() actor: Actor) {
    return this.integrations.status(actor);
  }

  @Patch()
  update(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.integrations.update(body, actor);
  }

  @Post("trm/refresh")
  refreshTrm(@CurrentActor() actor: Actor) {
    return this.integrations.refreshTrm(actor);
  }
}

@Controller("v1/exchange-rates")
export class ExchangeRatesController {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  @Post("trm/refresh")
  refresh(
    @Body() body: { effectiveDate?: string },
    @CurrentActor() actor: Actor,
  ) {
    if (actor.role !== "owner") throw new UnauthorizedException();
    return this.exchangeRates.refreshTrm(body.effectiveDate);
  }
}

@Controller("v1/categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.categories.list(actor);
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.categories.create(body, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.categories.update(id, body, actor);
  }

  @Delete(":id")
  archive(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.categories.archive(id, actor);
  }
}

@Controller("v1/analytics")
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("household")
  async household(@CurrentActor() actor: Actor) {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const [transactions, household] = await Promise.all([
      this.prisma.transactionAttribution.findMany({
        where: {
          householdId: actor.householdId,
          ledgerScope: "household",
          transactionType: "withdrawal",
          occurredAt: { gte: start },
        },
        select: {
          amount: true,
          category: true,
          merchant: true,
          payerMemberId: true,
          currency: true,
        },
      }),
      this.prisma.household.findUniqueOrThrow({
        where: { id: actor.householdId },
        select: { baseCurrency: true },
      }),
    ]);
    const byCategory = new Map<string, number>();
    for (const transaction of transactions) {
      const category = transaction.category ?? "Sin categoría";
      byCategory.set(
        category,
        (byCategory.get(category) ?? 0) + Number(transaction.amount),
      );
    }
    return {
      periodStart: start.toISOString(),
      currency: household.baseCurrency,
      spent: transactions
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0)
        .toString(),
      byCategory: [...byCategory.entries()].map(([category, amount]) => ({
        category,
        amount: amount.toString(),
      })),
      privacyScope: "household",
    };
  }

  @Post("safe-daily-spend")
  safe(@Body() body: Parameters<typeof safeDailySpend>[0]) {
    return { amount: safeDailySpend(body) };
  }
}

@Controller("v1/daily-check-ins")
export class CheckInController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  checkIn(
    @Body() body: { localDate: string; kind?: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.prisma.dailyCheckIn.upsert({
      where: {
        memberId_localDate: {
          memberId: actor.memberId,
          localDate: new Date(`${body.localDate}T00:00:00Z`),
        },
      },
      create: {
        householdId: actor.householdId,
        memberId: actor.memberId,
        localDate: new Date(`${body.localDate}T00:00:00Z`),
        kind: body.kind ?? "no_movements",
      },
      update: { kind: body.kind ?? "no_movements" },
    });
  }
}

@Controller("v1/insights")
export class InsightsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiCfoClient,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query("scope") requestedScope?: string) {
    const scope = requestedScope === "private" ? "private" : "household";
    return this.prisma.insight.findMany({
      where: {
        householdId: actor.householdId,
        scope,
        ...(scope === "private" ? { ownerMemberId: actor.memberId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  @Post("generate")
  async generate(
    @CurrentActor() actor: Actor,
    @Body() body: { scope?: "household" | "private" },
  ) {
    const scope = body.scope ?? "household";
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const [transactions, household, pockets] = await Promise.all([
      this.prisma.transactionAttribution.findMany({
        where: {
          householdId: actor.householdId,
          ledgerScope: scope,
          ...(scope === "private" ? { payerMemberId: actor.memberId } : {}),
          occurredAt: { gte: start, lte: now },
        },
        select: {
          id: true,
          amount: true,
          category: true,
          transactionType: true,
        },
      }),
      this.prisma.household.findUniqueOrThrow({
        where: { id: actor.householdId },
        select: { baseCurrency: true },
      }),
      this.prisma.pocket.findMany({
        where: {
          householdId: actor.householdId,
          status: "active",
          ...(scope === "household"
            ? { visibility: "household" }
            : { visibility: "private", ownerMemberId: actor.memberId }),
        },
        select: {
          id: true,
          name: true,
          currentAmount: true,
          currency: true,
          policy: true,
        },
      }),
    ]);
    const expenses = transactions.filter(
      (item) => item.transactionType === "withdrawal",
    );
    const receivedIncome = transactions
      .filter((item) => item.transactionType === "deposit")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const spent = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const evidence = transactions.slice(0, 50).map((item) => ({
      id: `transaction:${item.id}`,
      kind: "transaction",
      label: item.category ?? "Sin categoría",
      value: item.amount.toString(),
    }));
    const expectedIncomes = await this.prisma.expectedIncome.findMany({
      where: {
        householdId: actor.householdId,
        expectedDate: { gte: now },
        status: { in: ["planned", "confirmed"] },
        source:
          scope === "household"
            ? { visibility: "household" }
            : { visibility: "private", ownerMemberId: actor.memberId },
      },
      select: {
        id: true,
        expectedDate: true,
        expectedAmount: true,
        currency: true,
        probability: true,
        status: true,
        source: { select: { kind: true } },
      },
      orderBy: { expectedDate: "asc" },
      take: 24,
    });
    evidence.push(
      ...expectedIncomes.map((item) => ({
        id: `expected-income:${item.id}`,
        kind: "expected_income",
        label: item.source.kind,
        value: item.expectedAmount.toString(),
      })),
    );
    const categoryTotals = new Map<string, number>();
    for (const item of expenses) {
      const category = item.category ?? "Sin categoría";
      categoryTotals.set(
        category,
        (categoryTotals.get(category) ?? 0) + Number(item.amount),
      );
    }
    const news = await this.prisma.newsArticle.findMany({
      orderBy: { publishedAt: "desc" },
      take: 8,
    });
    const snapshot = {
      scope,
      period: {
        start: start.toISOString().slice(0, 10),
        end: now.toISOString().slice(0, 10),
        daysRemaining:
          new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
          ).getUTCDate() - now.getUTCDate(),
      },
      currency: household.baseCurrency,
      metrics: {
        income: receivedIncome.toString(),
        spent: spent.toString(),
        savingsRate: 0,
        safeDailySpend: "0",
      },
      stateBalances: {
        REAL: null,
        RESERVED: pockets
          .filter((pocket) => pocket.currency === household.baseCurrency)
          .reduce(
            (sum, pocket) => sum.plus(pocket.currentAmount),
            new Prisma.Decimal(0),
          )
          .toString(),
        REAL_RESERVED_BALANCE: null,
        PROJECTED: null,
      },
      pockets: pockets.map((pocket) => ({
        id: pocket.id,
        name: pocket.name,
        currentAmount: pocket.currentAmount.toString(),
        currency: pocket.currency,
        policy: pocket.policy,
      })),
      spendingBreakdown: [...categoryTotals.entries()].map(
        ([category, amount]) => ({ category, amount: amount.toString() }),
      ),
      recurringPatterns: [],
      anomalies: [],
      forecast: {
        expectedIncomes: expectedIncomes.map((item) => ({
          evidenceId: `expected-income:${item.id}`,
          sourceKind: item.source.kind,
          expectedDate: item.expectedDate.toISOString().slice(0, 10),
          expectedAmount: item.expectedAmount.toString(),
          currency: item.currency,
          probability: item.probability.toString(),
          status: item.status,
          availableBalance: false,
        })),
      },
      evidence,
      news: news.map((item) => ({
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt.toISOString(),
        title: item.title,
        summary: item.factSummary,
      })),
    };
    const status = await this.ai.status();
    if (!status.generationEnabled) {
      throw new ServiceUnavailableException(
        "AI-CFO no está configurado o se encuentra desactivado",
      );
    }
    const bundle = await this.ai.generate(snapshot);
    const normalizedBundle = bundle as {
      status?: string;
      alerts?: Array<{ severity?: string }>;
      opportunities?: Array<{
        action?: string;
        estimatedMonthlyImpact?: string;
        confidence?: number;
      }>;
    };
    const topOpportunity = normalizedBundle.opportunities?.[0];
    const priority = normalizedBundle.alerts?.some(
      (alert) => alert.severity === "critical",
    )
      ? "high"
      : normalizedBundle.alerts?.some((alert) => alert.severity === "warning")
        ? "medium"
        : "low";
    const insight = await this.prisma.insight.create({
      data: {
        householdId: actor.householdId,
        ownerMemberId: scope === "private" ? actor.memberId : null,
        scope,
        periodStart: start,
        periodEnd: now,
        payload: {
          bundle,
          title:
            normalizedBundle.status === "insufficient_data"
              ? "Datos insuficientes para el análisis"
              : "Análisis financiero del período",
          estimatedImpact: topOpportunity?.estimatedMonthlyImpact ?? null,
          priority,
          scope,
          period: snapshot.period,
          confidence: topOpportunity?.confidence ?? null,
          suggestedAction: topOpportunity?.action ?? null,
          provider: status.provider,
          model: status.model,
          generatedAt: now.toISOString(),
          evidence: snapshot.evidence,
        } as Prisma.InputJsonValue,
      },
    });
    return insight;
  }
}

@Controller("v1/ai-cfo")
export class AiCfoController {
  constructor(
    private readonly ai: AiCfoClient,
    private readonly prisma: PrismaService,
  ) {}

  @Get("status")
  status() {
    return this.ai.status();
  }

  @Post("test")
  async test(@CurrentActor() actor: Actor) {
    if (actor.role !== "owner") throw new UnauthorizedException();
    return this.ai.status();
  }

  @Get("chat")
  history(
    @CurrentActor() actor: Actor,
    @Query("scope") requestedScope?: string,
  ) {
    const scope = requestedScope === "private" ? "private" : "household";
    return this.prisma.chatMessage.findMany({
      where: {
        householdId: actor.householdId,
        scope,
        ...(scope === "private" ? { memberId: actor.memberId } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
  }

  @Delete("chat")
  async clearHistory(
    @CurrentActor() actor: Actor,
    @Query("scope") requestedScope?: string,
  ) {
    const scope = requestedScope === "private" ? "private" : "household";
    const result = await this.prisma.chatMessage.deleteMany({
      where: {
        householdId: actor.householdId,
        scope,
        ...(scope === "private" ? { memberId: actor.memberId } : {}),
      },
    });
    return { removed: result.count };
  }

  @Post("chat")
  async chat(
    @CurrentActor() actor: Actor,
    @Body() body: { message?: string; scope?: "household" | "private" },
  ) {
    const message = body.message?.trim();
    if (!message || message.length > 4_000)
      throw new BadRequestException(
        "El mensaje debe tener entre 1 y 4.000 caracteres",
      );
    const scope = body.scope === "private" ? "private" : "household";
    const [household, transactions, pockets, history] = await Promise.all([
      this.prisma.household.findUniqueOrThrow({
        where: { id: actor.householdId },
        select: { baseCurrency: true },
      }),
      this.prisma.transactionAttribution.findMany({
        where: {
          householdId: actor.householdId,
          ledgerScope: scope,
          ...(scope === "private" ? { payerMemberId: actor.memberId } : {}),
        },
        select: {
          amount: true,
          category: true,
          occurredAt: true,
          payerMemberId: true,
        },
        orderBy: { occurredAt: "desc" },
        take: 50,
      }),
      this.prisma.pocket.findMany({
        where: {
          householdId: actor.householdId,
          visibility: scope,
          ...(scope === "private" ? { ownerMemberId: actor.memberId } : {}),
          status: { not: "archived" },
        },
        select: {
          name: true,
          purpose: true,
          currency: true,
          currentAmount: true,
          policy: true,
        },
        take: 30,
      }),
      this.prisma.chatMessage.findMany({
        where: {
          householdId: actor.householdId,
          scope,
          ...(scope === "private" ? { memberId: actor.memberId } : {}),
        },
        select: { role: true, content: true },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
    ]);
    const totals = new Map<string, number>();
    const memberAliases = new Map<string, string>();
    const totalsByMember = new Map<string, number>();
    for (const item of transactions) {
      const category = item.category ?? "Sin categoría";
      totals.set(category, (totals.get(category) ?? 0) + Number(item.amount));
      if (!memberAliases.has(item.payerMemberId)) {
        memberAliases.set(
          item.payerMemberId,
          `Miembro ${memberAliases.size + 1}`,
        );
      }
      const alias = memberAliases.get(item.payerMemberId)!;
      totalsByMember.set(
        alias,
        (totalsByMember.get(alias) ?? 0) + Number(item.amount),
      );
    }
    const status = await this.ai.status();
    if (!status.generationEnabled)
      throw new ServiceUnavailableException(
        "AI-CFO no está configurado o se encuentra desactivado",
      );
    await this.prisma.chatMessage.create({
      data: {
        householdId: actor.householdId,
        memberId: actor.memberId,
        scope,
        role: "user",
        content: message,
      },
    });
    const response = await this.ai.chat({
      message,
      scope,
      currency: household.baseCurrency,
      history: history.reverse(),
      context: {
        period: "últimos 50 movimientos autorizados",
        spendingByCategory: [...totals.entries()].map(([category, amount]) => ({
          category,
          amount: amount.toString(),
        })),
        spendingByAnonymousMember: [...totalsByMember.entries()].map(
          ([member, amount]) => ({ member, amount: amount.toString() }),
        ),
        privacy: {
          identitiesRemoved: true,
          accountIdentifiersRemoved: true,
          freeTextNotesRemoved: true,
          privatePartnerDataExcluded: scope === "household",
        },
        pockets: pockets.map((pocket) => ({
          ...pocket,
          currentAmount: pocket.currentAmount.toString(),
        })),
      },
    });
    return this.prisma.chatMessage.create({
      data: {
        householdId: actor.householdId,
        memberId: actor.memberId,
        scope,
        role: "assistant",
        content: response.content,
        citations: response.citations as Prisma.InputJsonValue,
        provider: status.providerName ?? status.provider,
        model: status.model,
      },
    });
  }
}

@Controller("v1/news")
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  list() {
    return this.news.list();
  }

  @Post("refresh")
  refresh(@CurrentActor() actor: Actor) {
    if (actor.role !== "owner") throw new UnauthorizedException();
    return this.news.refresh();
  }

  @Get("status")
  status() {
    return this.news.status();
  }
}

@Controller("v1/automation/reminders")
export class AutomationController {
  constructor(private readonly reminders: RemindersService) {}

  private verify(token?: string) {
    if (
      !process.env.N8N_AUTOMATION_TOKEN ||
      token !== process.env.N8N_AUTOMATION_TOKEN
    ) {
      throw new UnauthorizedException();
    }
  }

  @Post("process")
  process(@Headers("x-automation-token") token: string | undefined) {
    this.verify(token);
    return this.reminders.processDue();
  }
}

@Controller("v1/reminders")
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get("preferences")
  preferences(@CurrentActor() actor: Actor) {
    return this.reminders.preference(actor);
  }

  @Put("preferences")
  updatePreferences(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.reminders.updatePreference(body, actor);
  }
}

@Controller("v1/push")
export class PushController {
  constructor(private readonly reminders: RemindersService) {}

  @Get("public-key")
  publicKey() {
    return this.reminders.publicKey();
  }

  @Post("subscriptions")
  subscribe(
    @Body() body: unknown,
    @Headers("user-agent") userAgent: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.reminders.subscribe(body, actor, userAgent);
  }

  @Delete("subscriptions")
  unsubscribe(
    @Body() body: { endpoint?: string },
    @CurrentActor() actor: Actor,
  ) {
    if (!body.endpoint)
      throw new BadRequestException("endpoint es obligatorio");
    return this.reminders.unsubscribe(body.endpoint, actor);
  }
}
