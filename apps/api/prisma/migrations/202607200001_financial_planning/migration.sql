CREATE TYPE "IncomeSourceKind" AS ENUM ('salary', 'bonus_midyear', 'bonus_endyear', 'rent', 'investment_income', 'freelance', 'business', 'pension', 'windfall', 'other');
CREATE TYPE "IncomeRecurrence" AS ENUM ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'custom');
CREATE TYPE "ExpectedIncomeStatus" AS ENUM ('planned', 'confirmed', 'received', 'cancelled');
CREATE TYPE "FinancialPlanStatus" AS ENUM ('draft', 'agreed', 'active', 'completed', 'archived');

CREATE TABLE "IncomeSource" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "ownerMemberId" TEXT NOT NULL,
  "visibility" "PocketVisibility" NOT NULL DEFAULT 'household',
  "name" TEXT NOT NULL,
  "kind" "IncomeSourceKind" NOT NULL,
  "currency" TEXT NOT NULL,
  "recurrence" "IncomeRecurrence" NOT NULL DEFAULT 'once',
  "defaultAmount" DECIMAL(30,8),
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncomeSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpectedIncome" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "expectedDate" DATE NOT NULL,
  "expectedAmount" DECIMAL(30,8) NOT NULL,
  "actualAmount" DECIMAL(30,8),
  "currency" TEXT NOT NULL,
  "status" "ExpectedIncomeStatus" NOT NULL DEFAULT 'planned',
  "probability" DECIMAL(5,4) NOT NULL DEFAULT 1,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "receivedAt" TIMESTAMP(3),
  "actualTransactionAttributionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpectedIncome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialPlan" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "ownerMemberId" TEXT NOT NULL,
  "visibility" "PocketVisibility" NOT NULL DEFAULT 'household',
  "title" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "horizon" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "FinancialPlanStatus" NOT NULL DEFAULT 'draft',
  "startDate" DATE NOT NULL,
  "targetDate" DATE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanFundingAllocation" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "expectedIncomeId" TEXT NOT NULL,
  "pocketId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "value" DECIMAL(30,8),
  "priority" INTEGER NOT NULL,
  "rationale" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "appliedAt" TIMESTAMP(3),
  "pocketEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanFundingAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanRevision" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "decisionNote" TEXT NOT NULL,
  "createdByMemberId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanAuditEvent" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "actorMemberId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncomeSource_householdId_visibility_active_idx" ON "IncomeSource"("householdId", "visibility", "active");
CREATE INDEX "IncomeSource_ownerMemberId_visibility_idx" ON "IncomeSource"("ownerMemberId", "visibility");
CREATE UNIQUE INDEX "ExpectedIncome_actualTransactionAttributionId_key" ON "ExpectedIncome"("actualTransactionAttributionId");
CREATE INDEX "ExpectedIncome_householdId_expectedDate_status_idx" ON "ExpectedIncome"("householdId", "expectedDate", "status");
CREATE INDEX "ExpectedIncome_sourceId_expectedDate_idx" ON "ExpectedIncome"("sourceId", "expectedDate");
CREATE UNIQUE INDEX "ExpectedIncome_sourceId_expectedDate_key" ON "ExpectedIncome"("sourceId", "expectedDate");
CREATE INDEX "FinancialPlan_householdId_visibility_status_idx" ON "FinancialPlan"("householdId", "visibility", "status");
CREATE INDEX "FinancialPlan_ownerMemberId_visibility_idx" ON "FinancialPlan"("ownerMemberId", "visibility");
CREATE INDEX "PlanFundingAllocation_householdId_expectedIncomeId_priority_idx" ON "PlanFundingAllocation"("householdId", "expectedIncomeId", "priority");
CREATE INDEX "PlanFundingAllocation_planId_priority_idx" ON "PlanFundingAllocation"("planId", "priority");
CREATE INDEX "PlanFundingAllocation_pocketId_status_idx" ON "PlanFundingAllocation"("pocketId", "status");
CREATE UNIQUE INDEX "PlanRevision_planId_version_key" ON "PlanRevision"("planId", "version");
CREATE INDEX "PlanRevision_householdId_createdAt_idx" ON "PlanRevision"("householdId", "createdAt");
CREATE INDEX "PlanAuditEvent_householdId_planId_createdAt_idx" ON "PlanAuditEvent"("householdId", "planId", "createdAt");

ALTER TABLE "IncomeSource" ADD CONSTRAINT "IncomeSource_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncomeSource" ADD CONSTRAINT "IncomeSource_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpectedIncome" ADD CONSTRAINT "ExpectedIncome_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpectedIncome" ADD CONSTRAINT "ExpectedIncome_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IncomeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpectedIncome" ADD CONSTRAINT "ExpectedIncome_actualTransactionAttributionId_fkey" FOREIGN KEY ("actualTransactionAttributionId") REFERENCES "TransactionAttribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialPlan" ADD CONSTRAINT "FinancialPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialPlan" ADD CONSTRAINT "FinancialPlan_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanFundingAllocation" ADD CONSTRAINT "PlanFundingAllocation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FinancialPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanFundingAllocation" ADD CONSTRAINT "PlanFundingAllocation_expectedIncomeId_fkey" FOREIGN KEY ("expectedIncomeId") REFERENCES "ExpectedIncome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanFundingAllocation" ADD CONSTRAINT "PlanFundingAllocation_pocketId_fkey" FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanRevision" ADD CONSTRAINT "PlanRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FinancialPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanRevision" ADD CONSTRAINT "PlanRevision_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanAuditEvent" ADD CONSTRAINT "PlanAuditEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FinancialPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanAuditEvent" ADD CONSTRAINT "PlanAuditEvent_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
