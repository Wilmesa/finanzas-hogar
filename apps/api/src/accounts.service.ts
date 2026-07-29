import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Actor } from "./auth.js";
import {
  FireflyClient,
  type CreateFireflyAccountInput,
  type LedgerScope,
} from "./firefly.client.js";
import { PrismaService } from "./prisma.service.js";

const Appearance = z.object({
  ownerMemberId: z.string().min(1).nullable().optional(),
  icon: z.string().trim().min(1).max(16).default("🏦"),
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i)
    .default("#123C69"),
});

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firefly: FireflyClient,
  ) {}

  async list(actor: Actor) {
    const [householdResult, privateResult, profiles, fundingLots, members] =
      await Promise.all([
        this.settledAccounts("household", actor.memberId),
        this.settledAccounts("private", actor.memberId),
        this.prisma.accountProfile.findMany({
          where: { householdId: actor.householdId },
          include: {
            owner: {
              select: { id: true, displayName: true, color: true },
            },
          },
        }),
        this.prisma.pocketFundingLot.groupBy({
          by: ["sourceLedgerScope", "sourceAccountId", "currency"],
          where: {
            householdId: actor.householdId,
            sourceAccountId: { not: null },
            remainingAmount: { gt: 0 },
          },
          _sum: { remainingAmount: true },
        }),
        this.prisma.member.findMany({
          where: { householdId: actor.householdId },
          select: { id: true, displayName: true, color: true },
        }),
      ]);
    const profileByAccount = new Map(
      profiles.map((profile) => [
        `${profile.ledgerScope}:${profile.fireflyAccountId}`,
        profile,
      ]),
    );
    const reservedByAccount = new Map(
      fundingLots.map((lot) => [
        `${lot.sourceLedgerScope}:${lot.sourceAccountId}:${lot.currency}`,
        lot._sum.remainingAmount ?? new Prisma.Decimal(0),
      ]),
    );
    const actorMember = members.find((member) => member.id === actor.memberId);
    const accounts = [
      ...householdResult.accounts,
      ...privateResult.accounts,
    ].map((account) => {
      const profile = profileByAccount.get(`${account.scope}:${account.id}`);
      const implicitOwner =
        account.scope === "private" ? actorMember : undefined;
      const owner = profile?.owner ?? implicitOwner ?? null;
      const reserved =
        reservedByAccount.get(
          `${account.scope}:${account.id}:${account.currency}`,
        ) ?? new Prisma.Decimal(0);
      const currentBalance = new Prisma.Decimal(account.currentBalance);
      return {
        ...account,
        ownerMemberId: owner?.id ?? null,
        ownerName:
          owner?.displayName ??
          (account.scope === "household" ? "Hogar" : "Mi cuenta"),
        icon: profile?.icon ?? "🏦",
        color: profile?.color ?? owner?.color ?? "#123C69",
        reservedAmount: reserved.toString(),
        availableBalance: currentBalance.minus(reserved).toString(),
      };
    });
    return {
      accounts,
      connections: [
        this.connection("household", householdResult, actor.memberId),
        this.connection("private", privateResult, actor.memberId),
      ],
    };
  }

  async create(
    input: CreateFireflyAccountInput & {
      scope: LedgerScope;
      ownerMemberId?: string | null;
      icon?: string;
      color?: string;
    },
    actor: Actor,
  ) {
    const appearance = Appearance.parse({
      ownerMemberId: input.ownerMemberId,
      icon: input.icon,
      color: input.color,
    });
    const ownerMemberId = await this.validateOwner(
      input.scope,
      appearance.ownerMemberId,
      actor,
    );
    const account = await this.firefly.createAccount(
      input,
      input.scope,
      actor.memberId,
    );
    await this.prisma.accountProfile.upsert({
      where: {
        householdId_ledgerScope_fireflyAccountId: {
          householdId: actor.householdId,
          ledgerScope: input.scope,
          fireflyAccountId: account.id,
        },
      },
      create: {
        householdId: actor.householdId,
        ledgerScope: input.scope,
        fireflyAccountId: account.id,
        ownerMemberId,
        icon: appearance.icon,
        color: appearance.color,
      },
      update: {
        ownerMemberId,
        icon: appearance.icon,
        color: appearance.color,
      },
    });
    return account;
  }

  async update(
    id: string,
    scope: LedgerScope,
    input: {
      name?: string;
      currency?: string;
      ownerMemberId?: string | null;
      icon?: string;
      color?: string;
    },
    actor: Actor,
  ) {
    await this.assertAccount(id, scope, actor);
    const updated = await this.firefly.updateAccount(
      id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
      scope,
      actor.memberId,
    );
    if (
      input.ownerMemberId !== undefined ||
      input.icon !== undefined ||
      input.color !== undefined
    ) {
      const appearance = Appearance.partial().parse(input);
      const ownerMemberId =
        appearance.ownerMemberId !== undefined
          ? await this.validateOwner(scope, appearance.ownerMemberId, actor)
          : undefined;
      await this.prisma.accountProfile.upsert({
        where: {
          householdId_ledgerScope_fireflyAccountId: {
            householdId: actor.householdId,
            ledgerScope: scope,
            fireflyAccountId: id,
          },
        },
        create: {
          householdId: actor.householdId,
          ledgerScope: scope,
          fireflyAccountId: id,
          ownerMemberId:
            ownerMemberId ?? (scope === "private" ? actor.memberId : null),
          icon: appearance.icon ?? "🏦",
          color: appearance.color ?? "#123C69",
        },
        update: {
          ...(ownerMemberId !== undefined ? { ownerMemberId } : {}),
          ...(appearance.icon !== undefined ? { icon: appearance.icon } : {}),
          ...(appearance.color !== undefined
            ? { color: appearance.color }
            : {}),
        },
      });
    }
    return updated;
  }

  async archive(id: string, scope: LedgerScope, actor: Actor) {
    await this.assertAccount(id, scope, actor);
    const reserved = await this.prisma.pocketFundingLot.aggregate({
      where: {
        householdId: actor.householdId,
        sourceLedgerScope: scope,
        sourceAccountId: id,
        remainingAmount: { gt: 0 },
      },
      _sum: { remainingAmount: true },
    });
    if (
      (reserved._sum.remainingAmount ?? new Prisma.Decimal(0)).greaterThan(0)
    ) {
      throw new BadRequestException(
        "Libera primero el dinero de los bolsillos financiados por esta cuenta",
      );
    }
    return this.firefly.archiveAccount(id, scope, actor.memberId);
  }

  async test(scope: LedgerScope, actor: Actor) {
    await this.firefly.testConnection(scope, actor.memberId);
    return { scope, status: "available" as const };
  }

  async assertAccount(id: string, scope: LedgerScope, actor: Actor) {
    const accounts = await this.firefly.listAssetAccounts(
      scope,
      actor.memberId,
    );
    const account = accounts.find((candidate) => candidate.id === id);
    if (!account) throw new NotFoundException();
    return account;
  }

  async availableForAllocation(id: string, scope: LedgerScope, actor: Actor) {
    const account = await this.assertAccount(id, scope, actor);
    const reserved = await this.prisma.pocketFundingLot.aggregate({
      where: {
        householdId: actor.householdId,
        sourceLedgerScope: scope,
        sourceAccountId: id,
        currency: account.currency,
        remainingAmount: { gt: 0 },
      },
      _sum: { remainingAmount: true },
    });
    const reservedAmount =
      reserved._sum.remainingAmount ?? new Prisma.Decimal(0);
    return {
      account,
      reservedAmount,
      availableAmount: new Prisma.Decimal(account.currentBalance).minus(
        reservedAmount,
      ),
    };
  }

  private async validateOwner(
    scope: LedgerScope,
    requestedOwner: string | null | undefined,
    actor: Actor,
  ) {
    if (scope === "private") return actor.memberId;
    if (!requestedOwner) return null;
    const member = await this.prisma.member.findFirst({
      where: { id: requestedOwner, householdId: actor.householdId },
      select: { id: true },
    });
    if (!member)
      throw new BadRequestException("La persona no pertenece al hogar");
    return member.id;
  }

  private async settledAccounts(scope: LedgerScope, memberId: string) {
    try {
      return {
        status: "available" as const,
        accounts: await this.firefly.listAssetAccounts(scope, memberId),
      };
    } catch {
      return { status: "unavailable" as const, accounts: [] };
    }
  }

  private connection(
    scope: LedgerScope,
    result: Awaited<ReturnType<AccountsService["settledAccounts"]>>,
    memberId: string,
  ) {
    return {
      scope,
      configured: this.firefly.hasToken(scope, memberId),
      status: result.status,
      ...(result.status === "unavailable"
        ? { message: "Este libro no está disponible en este momento" }
        : {}),
    };
  }
}
