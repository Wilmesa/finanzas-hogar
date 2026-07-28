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
        notes: input.notes || null,
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
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
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

  async archive(
    id: string,
    raw: { disposition?: "transfer" | "release"; destinationPocketId?: string },
    idempotencyKey: string,
    actor: Actor,
  ) {
    const pocket = await this.find(id, actor);
    if (pocket.ownerMemberId !== actor.memberId && actor.role !== "owner") {
      throw new NotFoundException();
    }
    const hasBalance = !pocket.currentAmount.isZero();
    if (hasBalance && !idempotencyKey) {
      throw new BadRequestException(
        "Idempotency-Key es obligatorio para reasignar el saldo",
      );
    }
    if (hasBalance && !raw.disposition) {
      throw new BadRequestException({
        code: "POCKET_BALANCE_REQUIRES_DISPOSITION",
        message: "Elige qué hacer con el saldo antes de archivar",
        currentAmount: pocket.currentAmount.toString(),
        currency: pocket.currency,
      });
    }
    let destination: Awaited<ReturnType<PocketsService["find"]>> | null = null;
    if (raw.disposition === "transfer") {
      if (!raw.destinationPocketId || raw.destinationPocketId === pocket.id) {
        throw new BadRequestException("Selecciona otro bolsillo de destino");
      }
      destination = await this.find(raw.destinationPocketId, actor);
      if (
        destination.status !== "active" ||
        destination.currency !== pocket.currency ||
        destination.visibility !== pocket.visibility
      ) {
        throw new BadRequestException(
          "El bolsillo de destino debe estar activo y usar la misma moneda y visibilidad",
        );
      }
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (hasBalance && raw.disposition === "transfer" && destination) {
          await tx.pocketEvent.createMany({
            data: [
              {
                householdId: actor.householdId,
                pocketId: pocket.id,
                actorMemberId: actor.memberId,
                type: "released",
                amount: pocket.currentAmount,
                currency: pocket.currency,
                planningOnly: true,
                idempotencyKey: `${idempotencyKey}:source`,
                metadata: { destinationPocketId: destination.id },
              },
              {
                householdId: actor.householdId,
                pocketId: destination.id,
                actorMemberId: actor.memberId,
                type: "allocated",
                amount: pocket.currentAmount,
                currency: pocket.currency,
                planningOnly: true,
                idempotencyKey: `${idempotencyKey}:destination`,
                metadata: { sourcePocketId: pocket.id },
              },
            ],
          });
          await tx.pocket.update({
            where: { id: destination.id },
            data: {
              currentAmount: { increment: pocket.currentAmount },
              version: { increment: 1 },
            },
          });
        } else if (hasBalance && raw.disposition === "release") {
          await tx.pocketEvent.create({
            data: {
              householdId: actor.householdId,
              pocketId: pocket.id,
              actorMemberId: actor.memberId,
              type: "released",
              amount: pocket.currentAmount,
              currency: pocket.currency,
              planningOnly: true,
              idempotencyKey: `${idempotencyKey}:release`,
            },
          });
        }
        const archived = await tx.pocket.update({
          where: { id: pocket.id },
          data: {
            ...(hasBalance ? { currentAmount: new Prisma.Decimal(0) } : {}),
            status: "archived",
            version: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            householdId: actor.householdId,
            actorMemberId: actor.memberId,
            entityType: "Pocket",
            entityId: pocket.id,
            action: "archived",
            before: JSON.parse(JSON.stringify(pocket)) as Prisma.InputJsonValue,
            after: JSON.parse(
              JSON.stringify(archived),
            ) as Prisma.InputJsonValue,
          },
        });
        return archived;
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

  async transfer(
    sourceId: string,
    raw: { destinationPocketId?: string; amount?: string },
    idempotencyKey: string,
    actor: Actor,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key es obligatorio");
    }
    const amount = new Decimal(raw.amount ?? 0);
    if (!amount.isPositive()) {
      throw new BadRequestException("La cantidad debe ser mayor que cero");
    }
    if (!raw.destinationPocketId || raw.destinationPocketId === sourceId) {
      throw new BadRequestException("Selecciona otro bolsillo de destino");
    }
    const [source, destination] = await Promise.all([
      this.find(sourceId, actor),
      this.find(raw.destinationPocketId, actor),
    ]);
    if (
      source.currency !== destination.currency ||
      source.visibility !== destination.visibility ||
      source.status !== "active" ||
      destination.status !== "active"
    ) {
      throw new BadRequestException(
        "Los bolsillos deben estar activos y usar la misma moneda y visibilidad",
      );
    }
    if (amount.greaterThan(source.currentAmount)) {
      throw new BadRequestException(
        "El bolsillo de origen no tiene saldo suficiente",
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const events = await Promise.all([
          tx.pocketEvent.create({
            data: {
              householdId: actor.householdId,
              pocketId: source.id,
              actorMemberId: actor.memberId,
              type: "released",
              amount: new Prisma.Decimal(amount.toString()),
              currency: source.currency,
              planningOnly: true,
              idempotencyKey: `${idempotencyKey}:released`,
              metadata: { destinationPocketId: destination.id },
            },
          }),
          tx.pocketEvent.create({
            data: {
              householdId: actor.householdId,
              pocketId: destination.id,
              actorMemberId: actor.memberId,
              type: "allocated",
              amount: new Prisma.Decimal(amount.toString()),
              currency: source.currency,
              planningOnly: true,
              idempotencyKey: `${idempotencyKey}:allocated`,
              metadata: { sourcePocketId: source.id },
            },
          }),
        ]);
        await Promise.all([
          tx.pocket.update({
            where: { id: source.id },
            data: {
              currentAmount: {
                decrement: new Prisma.Decimal(amount.toString()),
              },
              version: { increment: 1 },
            },
          }),
          tx.pocket.update({
            where: { id: destination.id },
            data: {
              currentAmount: {
                increment: new Prisma.Decimal(amount.toString()),
              },
              version: { increment: 1 },
            },
          }),
        ]);
        return { sourceId: source.id, destinationId: destination.id, events };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.pocketEvent.findUnique({
          where: {
            householdId_idempotencyKey: {
              householdId: actor.householdId,
              idempotencyKey: `${idempotencyKey}:released`,
            },
          },
        });
        if (existing) {
          return {
            sourceId: source.id,
            destinationId: destination.id,
            events: [existing],
            replayed: true,
          };
        }
      }
      throw error;
    }
  }
}
