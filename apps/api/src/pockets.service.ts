import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CreatePocketSchema,
  canReadPocket,
  projectGoalByContribution,
  projectGoalByDate,
} from "@finanzas/domain";
import { Decimal } from "decimal.js";
import type { Actor } from "./auth.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class PocketsService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: Actor) {
    return this.prisma.pocket.findMany({
      where: {
        householdId: actor.householdId,
        OR: [{ visibility: "household" }, { ownerMemberId: actor.memberId }],
        status: { not: "archived" },
      },
      orderBy: [{ visibility: "asc" }, { createdAt: "desc" }],
    });
  }

  async find(id: string, actor: Actor) {
    const pocket = await this.prisma.pocket.findUnique({ where: { id } });
    if (!pocket || !canReadPocket(pocket, actor)) throw new NotFoundException();
    return pocket;
  }

  create(raw: unknown, actor: Actor) {
    const input = CreatePocketSchema.parse(raw);
    return this.prisma.pocket.create({
      data: {
        householdId: actor.householdId,
        ownerMemberId: actor.memberId,
        visibility: input.visibility,
        purpose: input.purpose,
        name: input.name,
        currency: input.currency,
        policy: input.policy as Prisma.InputJsonValue,
        currentAmount: new Prisma.Decimal(input.currentAmount),
        rolloverPolicy: input.rolloverPolicy,
      },
    });
  }

  async project(id: string, actor: Actor, startDate: string) {
    const pocket = await this.find(id, actor);
    const policy = CreatePocketSchema.shape.policy.parse(pocket.policy);
    const common = {
      currentAmount: pocket.currentAmount.toString(),
      startDate,
      currency: pocket.currency,
    };
    if (policy.kind === "target_by_date") {
      return projectGoalByDate({ ...common, ...policy });
    }
    if (policy.kind === "target_by_contribution") {
      return projectGoalByContribution({ ...common, ...policy });
    }
    const limit = new Decimal(policy.limit);
    return {
      period: policy.period,
      limit: limit.toString(),
      currentAmount: pocket.currentAmount.toString(),
    };
  }

  async allocate(
    id: string,
    raw: { amount?: string },
    idempotencyKey: string,
    actor: Actor,
  ) {
    const amount = new Decimal(raw.amount ?? 0);
    if (!amount.isPositive())
      throw new ConflictException("El aporte debe ser mayor que cero");
    const pocket = await this.find(id, actor);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const event = await tx.pocketEvent.create({
          data: {
            householdId: actor.householdId,
            pocketId: pocket.id,
            actorMemberId: actor.memberId,
            type: "allocated",
            amount: new Prisma.Decimal(amount.toString()),
            currency: pocket.currency,
            planningOnly: true,
            idempotencyKey,
          },
        });
        const updated = await tx.pocket.update({
          where: { id: pocket.id },
          data: {
            currentAmount: { increment: new Prisma.Decimal(amount.toString()) },
            version: { increment: 1 },
          },
        });
        return { event, pocket: updated };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Esta operación ya fue procesada");
      }
      throw error;
    }
  }
}
