import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.js";
import { AiCfoClient } from "./ai-cfo.client.js";
import {
  AllocationController,
  AiCfoController,
  AccountsController,
  AnalyticsController,
  AutomationController,
  CategoriesController,
  CheckInController,
  HealthController,
  HouseholdController,
  InsightsController,
  NewsController,
  PlanningController,
  PocketsController,
  PushController,
  ProjectionsController,
  TransactionsController,
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

@Module({
  controllers: [
    HealthController,
    HouseholdController,
    PocketsController,
    AccountsController,
    PlanningController,
    ProjectionsController,
    TransactionsController,
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
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
