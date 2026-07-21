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
  UnauthorizedException,
} from "@nestjs/common";
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
    @Body() body: { amount?: string },
    @Headers("idempotency-key") key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    if (!key) throw new BadRequestException("Idempotency-Key es obligatorio");
    return this.pockets.allocate(id, body, key, actor);
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

@Controller("v1/accounts")
export class AccountsController {
  constructor(private readonly firefly: FireflyClient) {}

  @Get()
  async list(@CurrentActor() actor: Actor) {
    const [household, privateAccounts] = await Promise.all([
      this.firefly.listAssetAccounts("household", actor.memberId),
      this.firefly.listAssetAccounts("private", actor.memberId),
    ]);
    return [...household, ...privateAccounts];
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

  @Post("expected-incomes")
  createExpectedIncome(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.planning.createExpectedIncome(body, actor);
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
    @CurrentActor() actor: Actor,
  ) {
    return this.transactions.create(body, key ?? "", actor);
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
    const transactions = await this.prisma.transactionAttribution.findMany({
      where: {
        householdId: actor.householdId,
        ledgerScope: "household",
        occurredAt: { gte: start },
      },
      select: {
        amount: true,
        category: true,
        merchant: true,
        payerMemberId: true,
        currency: true,
      },
    });
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
      currency: "COP",
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
    const transactions = await this.prisma.transactionAttribution.findMany({
      where: {
        householdId: actor.householdId,
        ledgerScope: scope,
        ...(scope === "private" ? { payerMemberId: actor.memberId } : {}),
        occurredAt: { gte: start, lte: now },
      },
      select: { id: true, amount: true, category: true },
    });
    const spent = transactions.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
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
    for (const item of transactions) {
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
    return this.ai.generate({
      scope,
      period: {
        start: start.toISOString().slice(0, 10),
        end: now.toISOString().slice(0, 10),
        daysRemaining:
          new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
          ).getUTCDate() - now.getUTCDate(),
      },
      currency: "COP",
      metrics: {
        income: "0",
        spent: spent.toString(),
        savingsRate: 0,
        safeDailySpend: "0",
      },
      pockets: [],
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
