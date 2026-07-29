-- El flujo de caja real conserva la cuenta de origen de cada reserva y separa
-- el saldo bancario de los ajustes iniciales o de corrección.
CREATE TYPE "SpendingNature" AS ENUM ('household', 'personal');

ALTER TABLE "Pocket"
  ADD COLUMN "icon" TEXT NOT NULL DEFAULT '💰',
  ADD COLUMN "color" TEXT NOT NULL DEFAULT '#123C69';

ALTER TABLE "PocketEvent"
  ADD COLUMN "sourceAccountId" TEXT,
  ADD COLUMN "sourceLedgerScope" "LedgerScope",
  ADD COLUMN "correctionReason" TEXT;

ALTER TABLE "TransactionAttribution"
  ADD COLUMN "spendingNature" "SpendingNature" NOT NULL DEFAULT 'household',
  ADD COLUMN "sourceAccountId" TEXT,
  ADD COLUMN "destinationAccountId" TEXT;

ALTER TABLE "ExpectedIncome"
  ADD COLUMN "destinationAccountId" TEXT;

ALTER TABLE "PaymentPlan"
  ADD COLUMN "responsibleMemberId" TEXT;

CREATE TABLE "AccountProfile" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "fireflyAccountId" TEXT NOT NULL,
  "ledgerScope" "LedgerScope" NOT NULL,
  "ownerMemberId" TEXT,
  "icon" TEXT NOT NULL DEFAULT '🏦',
  "color" TEXT NOT NULL DEFAULT '#123C69',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PocketFundingLot" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "pocketId" TEXT NOT NULL,
  "sourceAccountId" TEXT,
  "sourceLedgerScope" "LedgerScope",
  "contributorMemberId" TEXT NOT NULL,
  "originalAmount" DECIMAL(30,8) NOT NULL,
  "remainingAmount" DECIMAL(30,8) NOT NULL,
  "currency" TEXT NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'account',
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PocketFundingLot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppNotification" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "recipientMemberId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unread',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

-- Los saldos ya existentes no se atribuyen a una cuenta arbitraria. Se
-- conservan como ajustes históricos por conciliar y se muestran así en UI.
INSERT INTO "PocketFundingLot" (
  "id", "householdId", "pocketId", "contributorMemberId",
  "originalAmount", "remainingAmount", "currency", "origin", "reason",
  "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text)::uuid::text,
  "householdId", "id", "ownerMemberId",
  "currentAmount", "currentAmount", "currency",
  'legacy_unreconciled',
  'Saldo existente antes de habilitar la trazabilidad por cuenta',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Pocket"
WHERE "currentAmount" > 0;

UPDATE "PaymentPlan"
SET "responsibleMemberId" = "ownerMemberId"
WHERE "responsibleMemberId" IS NULL;

CREATE UNIQUE INDEX "AccountProfile_householdId_ledgerScope_fireflyAccountId_key"
  ON "AccountProfile"("householdId", "ledgerScope", "fireflyAccountId");
CREATE INDEX "AccountProfile_householdId_ownerMemberId_ledgerScope_idx"
  ON "AccountProfile"("householdId", "ownerMemberId", "ledgerScope");
CREATE INDEX "PocketFundingLot_householdId_sourceLedgerScope_sourceAccountId_remainingAmount_idx"
  ON "PocketFundingLot"("householdId", "sourceLedgerScope", "sourceAccountId", "remainingAmount");
CREATE INDEX "PocketFundingLot_pocketId_remainingAmount_createdAt_idx"
  ON "PocketFundingLot"("pocketId", "remainingAmount", "createdAt");
CREATE INDEX "AppNotification_recipientMemberId_status_createdAt_idx"
  ON "AppNotification"("recipientMemberId", "status", "createdAt");
CREATE INDEX "AppNotification_householdId_entityType_entityId_idx"
  ON "AppNotification"("householdId", "entityType", "entityId");
CREATE INDEX "PaymentPlan_responsibleMemberId_status_nextDueDate_idx"
  ON "PaymentPlan"("responsibleMemberId", "status", "nextDueDate");

ALTER TABLE "AccountProfile"
  ADD CONSTRAINT "AccountProfile_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountProfile"
  ADD CONSTRAINT "AccountProfile_ownerMemberId_fkey"
  FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PocketFundingLot"
  ADD CONSTRAINT "PocketFundingLot_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PocketFundingLot"
  ADD CONSTRAINT "PocketFundingLot_pocketId_fkey"
  FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PocketFundingLot"
  ADD CONSTRAINT "PocketFundingLot_contributorMemberId_fkey"
  FOREIGN KEY ("contributorMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppNotification"
  ADD CONSTRAINT "AppNotification_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppNotification"
  ADD CONSTRAINT "AppNotification_recipientMemberId_fkey"
  FOREIGN KEY ("recipientMemberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan"
  ADD CONSTRAINT "PaymentPlan_responsibleMemberId_fkey"
  FOREIGN KEY ("responsibleMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
