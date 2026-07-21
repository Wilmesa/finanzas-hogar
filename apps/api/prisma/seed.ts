import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const householdId = process.env.HOUSEHOLD_ID ?? "household-demo";
  const memberAId = process.env.MEMBER_A_ID ?? "member-a";
  const memberBId = process.env.MEMBER_B_ID ?? "member-b";
  await prisma.household.upsert({
    where: { id: householdId },
    update: {},
    create: {
      id: householdId,
      name: process.env.HOUSEHOLD_NAME ?? "Nuestro hogar",
    },
  });
  await prisma.member.upsert({
    where: { id: memberAId },
    update: { householdId },
    create: {
      id: memberAId,
      householdId,
      displayName: process.env.MEMBER_A_NAME ?? "Ana",
      email: process.env.MEMBER_A_EMAIL ?? "ana@example.local",
      role: "owner",
    },
  });
  await prisma.member.upsert({
    where: { id: memberBId },
    update: { householdId },
    create: {
      id: memberBId,
      householdId,
      displayName: process.env.MEMBER_B_NAME ?? "Leo",
      email: process.env.MEMBER_B_EMAIL ?? "leo@example.local",
      role: "member",
    },
  });
}

main().finally(() => prisma.$disconnect());
