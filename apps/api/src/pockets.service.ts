import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CreatePocketSchema,
  UpdatePocketSchema,
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

  private parseCreate(raw: unknown) {
    const result = CreatePocketSchema.safeParse(raw);
    if (!result.success) {
      throw new BadRequestException({
        code: "POCKET_VALIDATION_FAILED",
        message: "Revisa los datos del bolsillo e inténtalo nuevamente",
        fields: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }

  create(raw: unknown, actor: Actor) {
    const input = this.parseCreate(raw);
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

  async update(id: string, raw: unknown, actor: Actor) {
    const pocket = await this.find(id, actor);
    if (pocket.ownerMemberId !== actor.memberId && actor.role !== "owner") {
      throw new NotFoundException();
    }
    const result = UpdatePocketSchema.safeParse(raw);
    if (!result.success) {
      throw new BadRequestException({
        code: "POCKET_VALIDATION_FAILED",
        message: "Revisa los cambios del bolsillo",
        fields: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const { version, ...input } = result.data;
    const updated = await this.prisma.pocket.updateMany({
      where: { id: pocket.id, version },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
        ...(input.visibility !== undefined
          ? { visibility: input.visibility }
          : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.policy !== undefined
          ? { policy: input.policy as Prisma.InputJsonValue }
          : {}),
        ...(input.rolloverPolicy !== undefined
          ? { rolloverPolicy: input.rolloverPolicy }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        "El bolsillo cambió en otro dispositivo. Actualiza e inténtalo de nuevo",
      );
    }
    return this.find(id, actor);
  }

  async archive(id: string, actor: Actor) {
    const pocket = await this.find(id, actor);
    if (pocket.ownerMemberId !== actor.memberId && actor.role !== "owner") {
      throw new NotFoundException();
    }
    return this.prisma.pocket.update({
      where: { id: pocket.id },
      data: { status: "archived", version: { increment: 1 } },
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
