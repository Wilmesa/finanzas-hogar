CREATE TYPE "PocketVisibility" AS ENUM ('household', 'private');
CREATE TYPE "PocketPurpose" AS ENUM ('daily_spend', 'sinking_fund', 'purchase', 'emergency', 'debt', 'investment', 'real_estate', 'custom');
CREATE TYPE "PocketStatus" AS ENUM ('active', 'paused', 'completed', 'archived');
CREATE TYPE "PocketEventType" AS ENUM ('allocated', 'released', 'spent', 'transferred', 'adjusted', 'goal_completed');
CREATE TYPE "LedgerScope" AS ENUM ('household', 'private');

CREATE TABLE "Household" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "baseCurrency" TEXT NOT NULL DEFAULT 'COP',
  "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Member" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Pocket" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "ownerMemberId" TEXT NOT NULL,
  "visibility" "PocketVisibility" NOT NULL DEFAULT 'household',
  "purpose" "PocketPurpose" NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "policy" JSONB NOT NULL,
  "currentAmount" DECIMAL(30,8) NOT NULL DEFAULT 0,
  "rolloverPolicy" TEXT NOT NULL DEFAULT 'carry_balance',
  "status" "PocketStatus" NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Pocket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PocketEvent" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "pocketId" TEXT NOT NULL,
  "actorMemberId" TEXT NOT NULL,
  "type" "PocketEventType" NOT NULL,
  "amount" DECIMAL(30,8) NOT NULL,
  "currency" TEXT NOT NULL,
  "planningOnly" BOOLEAN NOT NULL DEFAULT true,
  "fireflyTransactionId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PocketEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncomeAllocationRule" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "pocketId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "mode" TEXT NOT NULL,
  "value" DECIMAL(30,8),
  "cap" DECIMAL(30,8),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncomeAllocationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransactionAttribution" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "fireflyTransactionId" TEXT NOT NULL,
  "ledgerScope" "LedgerScope" NOT NULL,
  "pocketId" TEXT,
  "payerMemberId" TEXT NOT NULL,
  "category" TEXT,
  "merchant" TEXT,
  "amount" DECIMAL(30,8) NOT NULL,
  "currency" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransactionAttribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyCheckIn" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "localDate" DATE NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Insight" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "ownerMemberId" TEXT,
  "scope" "LedgerScope" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Member_householdId_idx" ON "Member"("householdId");
CREATE UNIQUE INDEX "Member_householdId_email_key" ON "Member"("householdId", "email");
CREATE INDEX "Pocket_householdId_visibility_status_idx" ON "Pocket"("householdId", "visibility", "status");
CREATE INDEX "Pocket_ownerMemberId_visibility_idx" ON "Pocket"("ownerMemberId", "visibility");
CREATE INDEX "PocketEvent_householdId_pocketId_createdAt_idx" ON "PocketEvent"("householdId", "pocketId", "createdAt");
CREATE UNIQUE INDEX "PocketEvent_householdId_idempotencyKey_key" ON "PocketEvent"("householdId", "idempotencyKey");
CREATE INDEX "IncomeAllocationRule_householdId_priority_idx" ON "IncomeAllocationRule"("householdId", "priority");
CREATE INDEX "TransactionAttribution_householdId_occurredAt_idx" ON "TransactionAttribution"("householdId", "occurredAt");
CREATE INDEX "TransactionAttribution_pocketId_occurredAt_idx" ON "TransactionAttribution"("pocketId", "occurredAt");
CREATE UNIQUE INDEX "TransactionAttribution_householdId_idempotencyKey_key" ON "TransactionAttribution"("householdId", "idempotencyKey");
CREATE UNIQUE INDEX "TransactionAttribution_ledgerScope_fireflyTransactionId_key" ON "TransactionAttribution"("ledgerScope", "fireflyTransactionId");
CREATE UNIQUE INDEX "DailyCheckIn_memberId_localDate_key" ON "DailyCheckIn"("memberId", "localDate");
CREATE INDEX "Insight_householdId_scope_createdAt_idx" ON "Insight"("householdId", "scope", "createdAt");

ALTER TABLE "Member" ADD CONSTRAINT "Member_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pocket" ADD CONSTRAINT "Pocket_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pocket" ADD CONSTRAINT "Pocket_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PocketEvent" ADD CONSTRAINT "PocketEvent_pocketId_fkey" FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PocketEvent" ADD CONSTRAINT "PocketEvent_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncomeAllocationRule" ADD CONSTRAINT "IncomeAllocationRule_pocketId_fkey" FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransactionAttribution" ADD CONSTRAINT "TransactionAttribution_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransactionAttribution" ADD CONSTRAINT "TransactionAttribution_pocketId_fkey" FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TransactionAttribution" ADD CONSTRAINT "TransactionAttribution_payerMemberId_fkey" FOREIGN KEY ("payerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NewsArticle" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "factSummary" TEXT NOT NULL,
  "topics" TEXT[] NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NewsArticle_sourceUrl_key" ON "NewsArticle"("sourceUrl");
CREATE INDEX "NewsArticle_publishedAt_idx" ON "NewsArticle"("publishedAt");
CREATE INDEX "NewsArticle_source_idx" ON "NewsArticle"("source");
