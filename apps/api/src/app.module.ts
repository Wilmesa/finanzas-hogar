import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.js";
import { AiCfoClient } from "./ai-cfo.client.js";
import {
  AllocationController,
  AiCfoController,
  AccountsController,
  CalendarController,
  AnalyticsController,
  AutomationController,
  CategoriesController,
  CheckInController,
  HealthController,
  HouseholdController,
  InsightsController,
  NewsController,
  NotificationsController,
  PlanningController,
  PocketsController,
  PaymentsController,
  PatrimonyController,
  PushController,
  ProjectionsController,
  SimulationsController,
  TransactionsController,
  ReviewController,
  SecurityController,
  TransactionRulesController,
  IngestionController,
  ExchangeRatesController,
  IntegrationsController,
  RemindersController,
} from "./controllers.js";
import { FireflyClient } from "./firefly.client.js";
import { PocketsService } from "./pockets.service.js";
import { NewsService } from "./news.service.js";
import { PlanningService } from "./planning.service.js";
import { PrismaService } from "./prisma.service.js";
import { TransactionsService } from "./transactions.service.js";
import { RemindersService } from "./reminders.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthenticationService } from "./auth.js";
import { LocalAuthService } from "./local-auth.service.js";
import { RedisService } from "./redis.service.js";
import { SessionStore } from "./session-store.js";
import { HouseholdService } from "./household.service.js";
import { CategoriesService } from "./categories.service.js";
import { PaymentsService } from "./payments.service.js";
import { PatrimonyService } from "./patrimony.service.js";
import { ExchangeRatesService } from "./exchange-rates.service.js";
import { IngestionService } from "./ingestion.service.js";
import { PrivateMetadataService } from "./private-metadata.service.js";
import { SimulationsService } from "./simulations.service.js";
import { TransactionRulesService } from "./transaction-rules.service.js";
import { MockOpenFinanceAdapter } from "./mock-open-finance.adapter.js";
import { HouseholdAccessService } from "./household-access.service.js";
import { IntegrationsService } from "./integrations.service.js";
import { AccountsService } from "./accounts.service.js";
import { CalendarService } from "./calendar.service.js";

@Module({
  controllers: [
    HealthController,
    HouseholdController,
    PocketsController,
    PaymentsController,
    PatrimonyController,
    AccountsController,
    CalendarController,
    NotificationsController,
    PlanningController,
    ProjectionsController,
    SimulationsController,
    TransactionsController,
    ReviewController,
    SecurityController,
    TransactionRulesController,
    IngestionController,
    ExchangeRatesController,
    IntegrationsController,
    CategoriesController,
    AllocationController,
    AiCfoController,
    AnalyticsController,
    CheckInController,
    InsightsController,
    NewsController,
    AutomationController,
    RemindersController,
    PushController,
    AuthController,
  ],
  providers: [
    PrismaService,
    AccountsService,
    CalendarService,
    PocketsService,
    TransactionsService,
    FireflyClient,
    AiCfoClient,
    NewsService,
    PlanningService,
    RemindersService,
    RedisService,
    SessionStore,
    LocalAuthService,
    AuthenticationService,
    HouseholdService,
    CategoriesService,
    PaymentsService,
    PatrimonyService,
    ExchangeRatesService,
    IngestionService,
    PrivateMetadataService,
    SimulationsService,
    TransactionRulesService,
    MockOpenFinanceAdapter,
    HouseholdAccessService,
    IntegrationsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
