-- Credenciales locales vinculadas uno a uno con los miembros financieros existentes.
CREATE TABLE "LocalUser" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passwordVersion" INTEGER NOT NULL DEFAULT 1,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LocalUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LocalUser_memberId_key" ON "LocalUser"("memberId");
CREATE UNIQUE INDEX "LocalUser_email_key" ON "LocalUser"("email");
CREATE UNIQUE INDEX "LocalUser_username_key" ON "LocalUser"("username");
CREATE INDEX "LocalUser_email_isActive_idx" ON "LocalUser"("email", "isActive");
CREATE INDEX "LocalUser_username_isActive_idx" ON "LocalUser"("username", "isActive");

ALTER TABLE "LocalUser" ADD CONSTRAINT "LocalUser_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
