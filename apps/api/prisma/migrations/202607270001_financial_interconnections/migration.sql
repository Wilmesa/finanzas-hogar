CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'REVIEWED', 'FLAGGED_FOR_PARTNER');
CREATE TYPE "TransactionOrigin" AS ENUM ('MANUAL', 'FIREFLY_WEBHOOK', 'OPEN_FINANCE', 'OFFLINE_SYNC');
CREATE TYPE "SimulationKind" AS ENUM ('savings', 'debt', 'cdt', 'investment', 'real_estate');
CREATE TYPE "SimulationStatus" AS ENUM ('draft', 'converted', 'archived');

ALTER TABLE "TransactionAttribution"
  ADD COLUMN "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'REVIEWED',
  ADD COLUMN "origin" "TransactionOrigin" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "transactionType" TEXT NOT NULL DEFAULT 'withdrawal',
  ADD COLUMN "externalTransactionId" TEXT,
  ADD COLUMN "importFingerprint" TEXT,
  ADD COLUMN "privateMetadataCiphertext" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByMemberId" TEXT,
  ADD COLUMN "flaggedForMemberId" TEXT;

CREATE INDEX "TransactionAttribution_householdId_externalTransactionId_idx"
  ON "TransactionAttribution"("householdId", "externalTransactionId");
CREATE INDEX "TransactionAttribution_householdId_reviewStatus_occurredAt_idx"
  ON "TransactionAttribution"("householdId", "reviewStatus", "occurredAt");
CREATE INDEX "TransactionAttribution_householdId_importFingerprint_idx"
  ON "TransactionAttribution"("householdId", "importFingerprint");

CREATE TABLE "TransactionRule" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "conditions" JSONB NOT NULL,
  "actions" JSONB NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdByMemberId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransactionRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransactionRule_householdId_fkey" FOREIGN KEY ("householdId")
    REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TransactionRule_householdId_enabled_priority_idx"
  ON "TransactionRule"("householdId", "enabled", "priority");

CREATE TABLE "ImportedTransaction" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "amount" DECIMAL(30,8) NOT NULL,
  "currency" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "merchant" TEXT NOT NULL,
  "sourceAccountId" TEXT,
  "destinationAccountId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "matchedImportedId" TEXT,
  "attributionId" TEXT,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportedTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportedTransaction_householdId_fkey" FOREIGN KEY ("householdId")
    REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImportedTransaction_attributionId_fkey" FOREIGN KEY ("attributionId")
    REFERENCES "TransactionAttribution"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ImportedTransaction_attributionId_key" ON "ImportedTransaction"("attributionId");
CREATE UNIQUE INDEX "ImportedTransaction_householdId_provider_externalId_key"
  ON "ImportedTransaction"("householdId", "provider", "externalId");
CREATE INDEX "ImportedTransaction_householdId_fingerprint_occurredAt_idx"
  ON "ImportedTransaction"("householdId", "fingerprint", "occurredAt");
CREATE INDEX "ImportedTransaction_householdId_status_createdAt_idx"
  ON "ImportedTransaction"("householdId", "status", "createdAt");

CREATE TABLE "PlanExecution" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "planVersion" INTEGER NOT NULL,
  "expectedIncomeId" TEXT,
  "actualTransactionId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "allocationResult" JSONB NOT NULL,
  "executedByMemberId" TEXT NOT NULL,
  "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanExecution_planId_fkey" FOREIGN KEY ("planId")
    REFERENCES "FinancialPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PlanExecution_householdId_fkey" FOREIGN KEY ("householdId")
    REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlanExecution_householdId_idempotencyKey_key"
  ON "PlanExecution"("householdId", "idempotencyKey");
CREATE INDEX "PlanExecution_planId_planVersion_executedAt_idx"
  ON "PlanExecution"("planId", "planVersion", "executedAt");
CREATE INDEX "PlanExecution_expectedIncomeId_idx" ON "PlanExecution"("expectedIncomeId");

ALTER TABLE "NetWorthSnapshot"
  ADD COLUMN "exchangeRates" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "components" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "ExchangeRate" (
  "id" TEXT NOT NULL,
  "baseCurrency" TEXT NOT NULL,
  "quoteCurrency" TEXT NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "rate" DECIMAL(30,12) NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExchangeRate_baseCurrency_quoteCurrency_effectiveDate_source_key"
  ON "ExchangeRate"("baseCurrency", "quoteCurrency", "effectiveDate", "source");
CREATE INDEX "ExchangeRate_effectiveDate_baseCurrency_quoteCurrency_idx"
  ON "ExchangeRate"("effectiveDate", "baseCurrency", "quoteCurrency");

CREATE TABLE "FinancialSimulation" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "ownerMemberId" TEXT NOT NULL,
  "visibility" "PocketVisibility" NOT NULL DEFAULT 'household',
  "kind" "SimulationKind" NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "assumptions" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "status" "SimulationStatus" NOT NULL DEFAULT 'draft',
  "convertedEntityType" TEXT,
  "convertedEntityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "convertedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "FinancialSimulation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialSimulation_householdId_fkey" FOREIGN KEY ("householdId")
    REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FinancialSimulation_householdId_visibility_status_createdAt_idx"
  ON "FinancialSimulation"("householdId", "visibility", "status", "createdAt");
CREATE INDEX "FinancialSimulation_ownerMemberId_visibility_idx"
  ON "FinancialSimulation"("ownerMemberId", "visibility");

CREATE TABLE "DebtAccount" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "ownerMemberId" TEXT NOT NULL,
  "visibility" "PocketVisibility" NOT NULL DEFAULT 'household',
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "principal" DECIMAL(30,8) NOT NULL,
  "annualRate" DECIMAL(12,8) NOT NULL,
  "minimumPayment" DECIMAL(30,8) NOT NULL,
  "extraPayment" DECIMAL(30,8) NOT NULL DEFAULT 0,
  "strategy" TEXT NOT NULL DEFAULT 'contractual',
  "projectedSchedule" JSONB NOT NULL,
  "projectedPayoffDate" DATE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "paymentPlanId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DebtAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DebtAccount_householdId_fkey" FOREIGN KEY ("householdId")
    REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DebtAccount_householdId_visibility_status_idx"
  ON "DebtAccount"("householdId", "visibility", "status");
CREATE INDEX "DebtAccount_ownerMemberId_visibility_idx"
  ON "DebtAccount"("ownerMemberId", "visibility");
CREATE INDEX "DebtAccount_paymentPlanId_idx" ON "DebtAccount"("paymentPlanId");
