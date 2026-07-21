import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Actor } from "./auth.js";
import { FireflyClient } from "./firefly.client.js";
import { PrismaService } from "./prisma.service.js";

const COLOR = /^#[0-9A-F]{6}$/i;

@Injectable()
export class HouseholdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firefly: FireflyClient,
  ) {}

  async get(actor: Actor) {
    const household = await this.prisma.household.findUniqueOrThrow({
      where: { id: actor.householdId },
      include: {
        members: {
          select: {
            id: true,
            displayName: true,
            email: true,
            role: true,
            avatar: true,
            color: true,
            localUser: { select: { username: true } },
          },
          orderBy: [{ role: "asc" }, { displayName: "asc" }],
        },
      },
    });
    return {
      id: household.id,
      name: household.name,
      baseCurrency: household.baseCurrency,
      timezone: household.timezone,
      onboardingCompletedAt: household.onboardingCompletedAt,
      currentMemberId: actor.memberId,
      currentRole: actor.role,
      members: household.members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        email: member.email,
        username: member.localUser?.username ?? null,
        role: member.role === "owner" ? "owner" : "member",
        avatar: member.avatar,
        color: member.color,
      })),
    };
  }

  async updateProfile(
    actor: Actor,
    raw: { displayName?: string; avatar?: string | null; color?: string },
  ) {
    const displayName = raw.displayName?.trim();
    if (
      displayName !== undefined &&
      (displayName.length < 2 || displayName.length > 60)
    ) {
      throw new BadRequestException(
        "El nombre debe tener entre 2 y 60 caracteres",
      );
    }
    if (raw.color !== undefined && !COLOR.test(raw.color)) {
      throw new BadRequestException("El color no es válido");
    }
    return this.prisma.member.update({
      where: { id: actor.memberId },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(raw.avatar !== undefined
          ? { avatar: raw.avatar?.slice(0, 32) || null }
          : {}),
        ...(raw.color !== undefined ? { color: raw.color.toUpperCase() } : {}),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        role: true,
        avatar: true,
        color: true,
      },
    });
  }

  async updateHousehold(
    actor: Actor,
    raw: { name?: string; baseCurrency?: string; timezone?: string },
  ) {
    if (actor.role !== "owner") throw new UnauthorizedException();
    const name = raw.name?.trim();
    if (name !== undefined && (name.length < 2 || name.length > 80)) {
      throw new BadRequestException("El nombre del hogar no es válido");
    }
    const baseCurrency = raw.baseCurrency?.trim().toUpperCase();
    if (baseCurrency !== undefined && !/^[A-Z]{3}$/.test(baseCurrency)) {
      throw new BadRequestException("La moneda base no es válida");
    }
    return this.prisma.household.update({
      where: { id: actor.householdId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(baseCurrency !== undefined ? { baseCurrency } : {}),
        ...(raw.timezone !== undefined ? { timezone: raw.timezone } : {}),
      },
      select: { id: true, name: true, baseCurrency: true, timezone: true },
    });
  }

  async onboarding(actor: Actor) {
    const [household, accounts, pockets, incomeSources] = await Promise.all([
      this.get(actor),
      Promise.allSettled([
        this.firefly.listAssetAccounts("household", actor.memberId),
        this.firefly.listAssetAccounts("private", actor.memberId),
      ]),
      this.prisma.pocket.count({
        where: {
          householdId: actor.householdId,
          OR: [{ visibility: "household" }, { ownerMemberId: actor.memberId }],
          status: { not: "archived" },
        },
      }),
      this.prisma.incomeSource.count({
        where: {
          householdId: actor.householdId,
          OR: [{ visibility: "household" }, { ownerMemberId: actor.memberId }],
          active: true,
        },
      }),
    ]);
    const householdAccounts =
      accounts[0].status === "fulfilled" ? accounts[0].value.length : 0;
    const privateAccounts =
      accounts[1].status === "fulfilled" ? accounts[1].value.length : 0;
    return {
      completedAt: household.onboardingCompletedAt,
      steps: {
        household: household.members.length >= 1,
        sharedFirefly: this.firefly.hasToken("household", actor.memberId),
        privateFirefly: this.firefly.hasToken("private", actor.memberId),
        sharedAccount: householdAccounts > 0,
        privateAccount: privateAccounts > 0,
        income: incomeSources > 0,
        pocket: pockets > 0,
        ai: Boolean(
          process.env.AI_CFO_URL && process.env.AI_CFO_INTERNAL_TOKEN,
        ),
      },
    };
  }

  completeOnboarding(actor: Actor) {
    return this.prisma.household.update({
      where: { id: actor.householdId },
      data: { onboardingCompletedAt: new Date() },
      select: { onboardingCompletedAt: true },
    });
  }
}
