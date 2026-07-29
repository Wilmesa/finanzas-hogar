import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Actor } from "./auth.js";
import { FireflyClient } from "./firefly.client.js";
import { PrismaService } from "./prisma.service.js";

const COLOR = /^#[0-9A-F]{6}$/i;
const DASHBOARD_SECTIONS = [
  "accounts",
  "pocketTotals",
  "recentTransactions",
  "dailyBudget",
  "advisor",
  "nextIncome",
] as const;

type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

interface UiPreferences {
  primaryColor: string;
  accentColor: string;
  dashboard: Record<DashboardSection, boolean>;
}

const DEFAULT_UI_PREFERENCES: UiPreferences = {
  primaryColor: "#123C69",
  accentColor: "#B9862E",
  dashboard: {
    accounts: true,
    pocketTotals: true,
    recentTransactions: true,
    dailyBudget: true,
    advisor: true,
    nextIncome: true,
  },
};

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
            uiPreferences: true,
            localUser: { select: { username: true } },
          },
          orderBy: [{ role: "asc" }, { displayName: "asc" }],
        },
      },
    });
    const currentMember = household.members.find(
      (member) => member.id === actor.memberId,
    );
    return {
      id: household.id,
      name: household.name,
      baseCurrency: household.baseCurrency,
      timezone: household.timezone,
      onboardingCompletedAt: household.onboardingCompletedAt,
      currentMemberId: actor.memberId,
      currentRole: actor.role,
      uiPreferences: this.normalizeUiPreferences(currentMember?.uiPreferences),
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

  async updateUiPreferences(actor: Actor, raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException("Las preferencias no son válidas");
    }
    const input = raw as {
      primaryColor?: unknown;
      accentColor?: unknown;
      dashboard?: unknown;
    };
    const current = await this.prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: { uiPreferences: true },
    });
    const preferences = this.normalizeUiPreferences(current.uiPreferences);
    if (
      input.primaryColor !== undefined &&
      (typeof input.primaryColor !== "string" ||
        !COLOR.test(input.primaryColor))
    ) {
      throw new BadRequestException("El color principal no es válido");
    }
    if (
      input.accentColor !== undefined &&
      (typeof input.accentColor !== "string" || !COLOR.test(input.accentColor))
    ) {
      throw new BadRequestException("El color de acento no es válido");
    }
    const dashboard = { ...preferences.dashboard };
    if (input.dashboard !== undefined) {
      if (
        !input.dashboard ||
        typeof input.dashboard !== "object" ||
        Array.isArray(input.dashboard)
      ) {
        throw new BadRequestException(
          "La personalización del inicio no es válida",
        );
      }
      for (const section of DASHBOARD_SECTIONS) {
        const value = (input.dashboard as Record<string, unknown>)[section];
        if (value !== undefined) {
          if (typeof value !== "boolean") {
            throw new BadRequestException(
              "La visibilidad de cada sección debe ser verdadera o falsa",
            );
          }
          dashboard[section] = value;
        }
      }
    }
    const updated: UiPreferences = {
      primaryColor:
        typeof input.primaryColor === "string"
          ? input.primaryColor.toUpperCase()
          : preferences.primaryColor,
      accentColor:
        typeof input.accentColor === "string"
          ? input.accentColor.toUpperCase()
          : preferences.accentColor,
      dashboard,
    };
    await this.prisma.member.update({
      where: { id: actor.memberId },
      data: {
        uiPreferences: JSON.parse(
          JSON.stringify(updated),
        ) as Prisma.InputJsonValue,
      },
    });
    return updated;
  }

  private normalizeUiPreferences(raw: unknown): UiPreferences {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return structuredClone(DEFAULT_UI_PREFERENCES);
    }
    const value = raw as {
      primaryColor?: unknown;
      accentColor?: unknown;
      dashboard?: unknown;
    };
    const dashboard = { ...DEFAULT_UI_PREFERENCES.dashboard };
    if (
      value.dashboard &&
      typeof value.dashboard === "object" &&
      !Array.isArray(value.dashboard)
    ) {
      for (const section of DASHBOARD_SECTIONS) {
        const visible = (value.dashboard as Record<string, unknown>)[section];
        if (typeof visible === "boolean") dashboard[section] = visible;
      }
    }
    return {
      primaryColor:
        typeof value.primaryColor === "string" && COLOR.test(value.primaryColor)
          ? value.primaryColor.toUpperCase()
          : DEFAULT_UI_PREFERENCES.primaryColor,
      accentColor:
        typeof value.accentColor === "string" && COLOR.test(value.accentColor)
          ? value.accentColor.toUpperCase()
          : DEFAULT_UI_PREFERENCES.accentColor,
      dashboard,
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
