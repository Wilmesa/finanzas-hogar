CREATE TABLE "HouseholdInvitation" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationPreference" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "trmDailySyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "openFinanceMode" TEXT NOT NULL DEFAULT 'disabled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HouseholdInvitation_tokenHash_key"
ON "HouseholdInvitation"("tokenHash");

CREATE INDEX "HouseholdInvitation_householdId_expiresAt_usedAt_idx"
ON "HouseholdInvitation"("householdId", "expiresAt", "usedAt");

CREATE UNIQUE INDEX "IntegrationPreference_householdId_key"
ON "IntegrationPreference"("householdId");

ALTER TABLE "HouseholdInvitation"
ADD CONSTRAINT "HouseholdInvitation_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HouseholdInvitation"
ADD CONSTRAINT "HouseholdInvitation_createdByMemberId_fkey"
FOREIGN KEY ("createdByMemberId") REFERENCES "Member"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationPreference"
ADD CONSTRAINT "IntegrationPreference_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
