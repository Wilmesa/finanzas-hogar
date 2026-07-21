import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import { hashPassword, validatePassword } from "../src/password.js";
import { memberSessionsKey } from "../src/session-store.js";

const prisma = new PrismaClient();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

async function revokeMemberSessions(memberId: string) {
  const redis = createClient({
    url: process.env.REDIS_URL ?? "redis://redis:6379",
  });
  await redis.connect();
  const memberKey = memberSessionsKey(memberId);
  const sessionKeys = await redis.sMembers(memberKey);
  if (sessionKeys.length) await redis.del(sessionKeys);
  await redis.del(memberKey);
  await redis.quit();
}

async function upsertUser(label: "A" | "B", householdId: string) {
  const memberId = required(`MEMBER_${label}_ID`);
  const email = required(`MEMBER_${label}_EMAIL`).toLowerCase();
  const username = required(`MEMBER_${label}_USERNAME`).toLowerCase();
  const displayName = required(`MEMBER_${label}_NAME`);
  const password = required(`MEMBER_${label}_BOOTSTRAP_PASSWORD`);
  validatePassword(password);
  const passwordHash = await hashPassword(password);

  await prisma.member.upsert({
    where: { id: memberId },
    update: { householdId, email, displayName },
    create: {
      id: memberId,
      householdId,
      email,
      displayName,
      role: label === "A" ? "owner" : "member",
    },
  });
  const existing = await prisma.localUser.findUnique({ where: { memberId } });
  await prisma.localUser.upsert({
    where: { memberId },
    update: {
      email,
      username,
      passwordHash,
      isActive: true,
      passwordVersion: { increment: 1 },
      passwordChangedAt: new Date(),
    },
    create: { memberId, email, username, passwordHash },
  });
  if (existing) await revokeMemberSessions(memberId);
  console.log(`Usuario ${label} creado o actualizado para ${email}.`);
}

async function main() {
  if (process.env.AUTH_MODE !== "local") {
    throw new Error("El bootstrap local requiere AUTH_MODE=local");
  }
  const householdId = required("HOUSEHOLD_ID");
  await prisma.household.upsert({
    where: { id: householdId },
    update: { name: required("HOUSEHOLD_NAME") },
    create: { id: householdId, name: required("HOUSEHOLD_NAME") },
  });
  const selected = process.env.LOCAL_USER_LABEL?.toUpperCase() ?? "ALL";
  if (!["A", "B", "ALL"].includes(selected))
    throw new Error("LOCAL_USER_LABEL debe ser A, B o ALL");
  if (selected === "A" || selected === "ALL")
    await upsertUser("A", householdId);
  if (selected === "B" || selected === "ALL")
    await upsertUser("B", householdId);
  console.log(
    "Bootstrap terminado. Las contraseñas no se guardaron ni se mostraron.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Bootstrap falló");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
