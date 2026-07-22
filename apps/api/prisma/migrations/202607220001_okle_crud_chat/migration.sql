CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT 'tag',
  "color" TEXT NOT NULL DEFAULT '#123C69',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "actorMemberId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "scope" "LedgerScope" NOT NULL DEFAULT 'household',
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "citations" JSONB,
  "provider" TEXT,
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Category_householdId_name_key" ON "Category"("householdId", "name");
CREATE INDEX "Category_householdId_active_name_idx" ON "Category"("householdId", "active", "name");
CREATE INDEX "AuditLog_householdId_entityType_entityId_createdAt_idx" ON "AuditLog"("householdId", "entityType", "entityId", "createdAt");
CREATE INDEX "AuditLog_actorMemberId_createdAt_idx" ON "AuditLog"("actorMemberId", "createdAt");
CREATE INDEX "ChatMessage_householdId_memberId_scope_createdAt_idx" ON "ChatMessage"("householdId", "memberId", "scope", "createdAt");

ALTER TABLE "Category" ADD CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Category" ("id", "householdId", "name", "icon", "color", "updatedAt")
SELECT gen_random_uuid()::text, "id", category."name", category."icon", category."color", CURRENT_TIMESTAMP
FROM "Household"
CROSS JOIN (VALUES
  ('Mercado', 'shopping-cart', '#123C69'),
  ('Transporte', 'bus', '#4C8DFF'),
  ('Restaurantes', 'utensils', '#B9862E'),
  ('Vivienda', 'home', '#6B7280'),
  ('Salud', 'heart-pulse', '#D64550'),
  ('Otros', 'tag', '#5B6B79')
) AS category("name", "icon", "color")
ON CONFLICT DO NOTHING;
