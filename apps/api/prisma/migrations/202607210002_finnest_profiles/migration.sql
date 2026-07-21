-- Datos visuales y estado de onboarding. Migración aditiva y no destructiva.
ALTER TABLE "Household"
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "Member"
ADD COLUMN "avatar" TEXT,
ADD COLUMN "color" TEXT NOT NULL DEFAULT '#059669';

ALTER TABLE "TransactionAttribution"
ALTER COLUMN "fireflyTransactionId" DROP NOT NULL,
ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'synchronized',
ADD COLUMN "syncError" TEXT,
ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3);

ALTER TABLE "TransactionAttribution"
ALTER COLUMN "syncStatus" SET DEFAULT 'pending';

DROP INDEX IF EXISTS "TransactionAttribution_ledgerScope_fireflyTransactionId_key";
CREATE UNIQUE INDEX "TransactionAttribution_ledgerScope_payerMemberId_fireflyTransactionId_key"
ON "TransactionAttribution"("ledgerScope", "payerMemberId", "fireflyTransactionId");
