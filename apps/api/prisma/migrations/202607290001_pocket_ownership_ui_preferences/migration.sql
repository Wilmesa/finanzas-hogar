ALTER TABLE "Member"
ADD COLUMN "uiPreferences" JSONB;

ALTER TABLE "Pocket"
ADD COLUMN "defaultAccountId" TEXT,
ADD COLUMN "defaultLedgerScope" "LedgerScope";

ALTER TABLE "AccountProfile"
ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Pocket_householdId_defaultLedgerScope_defaultAccountId_idx"
ON "Pocket"("householdId", "defaultLedgerScope", "defaultAccountId");
