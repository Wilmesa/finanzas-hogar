ALTER TABLE "PlanFundingAllocation" ALTER COLUMN "pocketId" DROP NOT NULL;
ALTER TABLE "PlanFundingAllocation" ADD COLUMN "paymentPlanId" TEXT;
ALTER TABLE "PlanFundingAllocation" ADD COLUMN "executedAmount" DECIMAL(30,8) NOT NULL DEFAULT 0;
ALTER TABLE "PlanFundingAllocation" ADD CONSTRAINT "PlanFundingAllocation_exactly_one_destination_check"
  CHECK (("pocketId" IS NOT NULL AND "paymentPlanId" IS NULL) OR ("pocketId" IS NULL AND "paymentPlanId" IS NOT NULL));

CREATE TABLE "PaymentPlan" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "ownerMemberId" TEXT NOT NULL,
  "visibility" "PocketVisibility" NOT NULL DEFAULT 'household', "name" TEXT NOT NULL,
  "type" TEXT NOT NULL, "currency" TEXT NOT NULL, "totalAmount" DECIMAL(30,8),
  "estimatedAmount" DECIMAL(30,8), "recurrence" TEXT NOT NULL DEFAULT 'monthly',
  "dueDay" INTEGER, "nextDueDate" DATE, "paymentUrl" TEXT, "reference" TEXT,
  "notes" TEXT, "status" TEXT NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PaymentOccurrence" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "paymentPlanId" TEXT NOT NULL,
  "dueDate" DATE NOT NULL, "plannedAmount" DECIMAL(30,8), "actualAmount" DECIMAL(30,8),
  "status" TEXT NOT NULL DEFAULT 'planned', "paidAt" TIMESTAMP(3), "sourcePocketId" TEXT,
  "transactionAttributionId" TEXT, "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PaymentOccurrence_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InvestmentPosition" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "ownerMemberId" TEXT NOT NULL,
  "pocketId" TEXT, "visibility" "PocketVisibility" NOT NULL DEFAULT 'household', "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL, "institution" TEXT, "currency" TEXT NOT NULL, "principal" DECIMAL(30,8) NOT NULL,
  "openedAt" DATE NOT NULL, "maturityDate" DATE, "annualRate" DECIMAL(12,8), "expectedGrossGain" DECIMAL(30,8),
  "feesAndTaxes" DECIMAL(30,8), "expectedNetGain" DECIMAL(30,8), "ticker" TEXT, "units" DECIMAL(30,8),
  "purchasePrice" DECIMAL(30,8), "currentPrice" DECIMAL(30,8), "priceAsOf" TIMESTAMP(3), "sourceUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "InvestmentPosition_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PropertyAsset" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "ownerMemberId" TEXT NOT NULL,
  "visibility" "PocketVisibility" NOT NULL DEFAULT 'household', "name" TEXT NOT NULL, "type" TEXT NOT NULL,
  "currency" TEXT NOT NULL, "purchaseValue" DECIMAL(30,8), "currentEstimatedValue" DECIMAL(30,8) NOT NULL,
  "purchaseDate" DATE, "locationSector" TEXT, "annualAppreciation" DECIMAL(12,8), "lastValuationAt" DATE NOT NULL,
  "notes" TEXT, "status" TEXT NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PropertyAsset_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NetWorthSnapshot" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "recordedAt" DATE NOT NULL, "currency" TEXT NOT NULL,
  "assets" DECIMAL(30,8) NOT NULL, "liabilities" DECIMAL(30,8) NOT NULL, "netWorth" DECIMAL(30,8) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'calculated', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NetWorthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentOccurrence_paymentPlanId_dueDate_key" ON "PaymentOccurrence"("paymentPlanId", "dueDate");
CREATE INDEX "PaymentPlan_householdId_visibility_status_nextDueDate_idx" ON "PaymentPlan"("householdId", "visibility", "status", "nextDueDate");
CREATE INDEX "PaymentPlan_ownerMemberId_visibility_idx" ON "PaymentPlan"("ownerMemberId", "visibility");
CREATE INDEX "PaymentOccurrence_householdId_dueDate_status_idx" ON "PaymentOccurrence"("householdId", "dueDate", "status");
CREATE INDEX "InvestmentPosition_householdId_visibility_status_idx" ON "InvestmentPosition"("householdId", "visibility", "status");
CREATE INDEX "InvestmentPosition_ownerMemberId_visibility_idx" ON "InvestmentPosition"("ownerMemberId", "visibility");
CREATE INDEX "PropertyAsset_householdId_visibility_status_idx" ON "PropertyAsset"("householdId", "visibility", "status");
CREATE UNIQUE INDEX "NetWorthSnapshot_householdId_recordedAt_currency_key" ON "NetWorthSnapshot"("householdId", "recordedAt", "currency");
CREATE INDEX "NetWorthSnapshot_householdId_recordedAt_idx" ON "NetWorthSnapshot"("householdId", "recordedAt");
CREATE INDEX "PlanFundingAllocation_paymentPlanId_status_idx" ON "PlanFundingAllocation"("paymentPlanId", "status");

ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentOccurrence" ADD CONSTRAINT "PaymentOccurrence_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentOccurrence" ADD CONSTRAINT "PaymentOccurrence_paymentPlanId_fkey" FOREIGN KEY ("paymentPlanId") REFERENCES "PaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentOccurrence" ADD CONSTRAINT "PaymentOccurrence_sourcePocketId_fkey" FOREIGN KEY ("sourcePocketId") REFERENCES "Pocket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvestmentPosition" ADD CONSTRAINT "InvestmentPosition_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentPosition" ADD CONSTRAINT "InvestmentPosition_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvestmentPosition" ADD CONSTRAINT "InvestmentPosition_pocketId_fkey" FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PropertyAsset" ADD CONSTRAINT "PropertyAsset_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PropertyAsset" ADD CONSTRAINT "PropertyAsset_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NetWorthSnapshot" ADD CONSTRAINT "NetWorthSnapshot_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanFundingAllocation" ADD CONSTRAINT "PlanFundingAllocation_paymentPlanId_fkey" FOREIGN KEY ("paymentPlanId") REFERENCES "PaymentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
