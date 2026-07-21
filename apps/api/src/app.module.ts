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
  ProjectionsController,
  TransactionsController,
} from "./controllers.js";
import { FireflyClient } from "./firefly.client.js";
import { PocketsService } from "./pockets.service.js";
import { NewsService } from "./news.service.js";
import { PlanningService } from "./planning.service.js";
import { PrismaService } from "./prisma.service.js";
import { TransactionsService } from "./transactions.service.js";

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
  ],
  providers: [
    PrismaService,
    PocketsService,
    TransactionsService,
    FireflyClient,
    AiCfoClient,
    NewsService,
    PlanningService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
