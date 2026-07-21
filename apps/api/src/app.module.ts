import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.js";
import { AiCfoClient } from "./ai-cfo.client.js";
import {
  AllocationController,
  AccountsController,
  AnalyticsController,
  AutomationController,
  CheckInController,
  HealthController,
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

@Module({
  controllers: [
    HealthController,
    PocketsController,
    AccountsController,
    PlanningController,
    ProjectionsController,
    TransactionsController,
    AllocationController,
    AnalyticsController,
    CheckInController,
    InsightsController,
    NewsController,
    AutomationController,
    RemindersController,
    PushController,
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
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
