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
import { AccountsService } from "./accounts.service.js";
import type { LedgerScope } from "./firefly.client.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class PocketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  async list(actor: Actor) {
    const pockets = await this.prisma.pocket.findMany({
      where: {
        householdId: actor.householdId,
        OR: [{ visibility: "household" }, { ownerMemberId: actor.memberId }],
        status: { not: "archived" },
      },
      orderBy: [{ visibility: "asc" }, { createdAt: "desc" }],
      include: {
        owner: {
          select: { id: true, displayName: true, color: true },
        },
        fundingLots: {
          where: { remainingAmount: { gt: 0 } },
          select: {
            id: true,
            sourceAccountId: true,
            sourceLedgerScope: true,
            contributorMemberId: true,
            remainingAmount: true,
            currency: true,
            origin: true,
            reason: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return pockets.map((pocket) => ({
      ...pocket,
      canManage: pocket.ownerMemberId === actor.memberId,
      unreconciledAmount: pocket.fundingLots
        .filter((lot) => !lot.sourceAccountId)
        .reduce(
          (sum, lot) => sum.plus(lot.remainingAmount),
          new Prisma.Decimal(0),
        )
        .toString(),
    }));
  }

  async find(id: string, actor: Actor) {
    const pocket = await this.prisma.pocket.findUnique({ where: { id } });
    if (!pocket || !canReadPocket(pocket, actor)) throw new NotFoundException();
    return pocket;
  }

  private assertOwner(pocket: { ownerMemberId: string }, actor: Actor): void {
    if (pocket.ownerMemberId !== actor.memberId) {
      throw new NotFoundException();
    }
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
    const initialAmount = new Prisma.Decimal(input.currentAmount);
    if (initialAmount.greaterThan(0) && !input.initialBalanceReason) {
      throw new BadRequestException(
        "Explica el origen del saldo inicial para conservar la trazabilidad",
      );
    }
    const initialBalanceReason = input.initialBalanceReason ?? null;
    return this.prisma.$transaction(async (tx) => {
      const pocket = await tx.pocket.create({
        data: {
          householdId: actor.householdId,
          ownerMemberId: actor.memberId,
          visibility: input.visibility,
          purpose: input.purpose,
          name: input.name,
          notes: input.notes || null,
          icon: input.icon,
          color: input.color,
          currency: input.currency,
          policy: input.policy as Prisma.InputJsonValue,
          currentAmount: initialAmount,
          rolloverPolicy: input.rolloverPolicy,
        },
      });
      if (initialAmount.greaterThan(0)) {
        await tx.pocketFundingLot.create({
          data: {
            householdId: actor.householdId,
            pocketId: pocket.id,
            contributorMemberId: actor.memberId,
            originalAmount: initialAmount,
            remainingAmount: initialAmount,
            currency: pocket.currency,
            origin: "initial_adjustment",
            reason: initialBalanceReason,
          },
        });
        await tx.pocketEvent.create({
          data: {
            householdId: actor.householdId,
            pocketId: pocket.id,
            actorMemberId: actor.memberId,
            type: "adjusted",
            amount: initialAmount,
            currency: pocket.currency,
            planningOnly: true,
            correctionReason: initialBalanceReason,
            idempotencyKey: `pocket-created:${pocket.id}`,
          },
        });
      }
      return pocket;
    });
  }

  async update(id: string, raw: unknown, actor: Actor) {
    const pocket = await this.find(id, actor);
    this.assertOwner(pocket, actor);
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
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
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
    this.assertOwner(pocket, actor);
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
      this.assertOwner(destination, actor);
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
          await this.moveFundingLots(
            tx,
            pocket.id,
            destination.id,
            pocket.currentAmount,
          );
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
          await tx.pocketFundingLot.updateMany({
            where: { pocketId: pocket.id, remainingAmount: { gt: 0 } },
            data: { remainingAmount: new Prisma.Decimal(0) },
          });
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
    raw: {
      amount?: string;
      sourceAccountId?: string;
      sourceLedgerScope?: LedgerScope;
      mode?: "account" | "initial_adjustment" | "correction";
      reason?: string;
    },
    idempotencyKey: string,
    actor: Actor,
  ) {
    const amount = new Decimal(raw.amount ?? 0);
    if (!amount.isPositive())
      throw new ConflictException("El aporte debe ser mayor que cero");
    const pocket = await this.find(id, actor);
    this.assertOwner(pocket, actor);
    const mode = raw.mode ?? "account";
    const reason = raw.reason?.trim();
    let sourceAccountId: string | null = null;
    let sourceLedgerScope: LedgerScope | null = null;
    if (mode === "account") {
      if (!raw.sourceAccountId || !raw.sourceLedgerScope) {
        throw new BadRequestException(
          "Selecciona la cuenta real de donde sale el dinero",
        );
      }
      const availability = await this.accounts.availableForAllocation(
        raw.sourceAccountId,
        raw.sourceLedgerScope,
        actor,
      );
      await this.accounts.assertOwnedAccount(
        raw.sourceAccountId,
        raw.sourceLedgerScope,
        pocket.ownerMemberId,
        actor,
      );
      if (availability.account.currency !== pocket.currency) {
        throw new BadRequestException(
          "La cuenta y el bolsillo deben usar la misma moneda",
        );
      }
      if (amount.greaterThan(availability.availableAmount.toString())) {
        throw new BadRequestException(
          `La cuenta solo tiene ${availability.availableAmount.toString()} ${pocket.currency} disponibles para asignar`,
        );
      }
      sourceAccountId = raw.sourceAccountId;
      sourceLedgerScope = raw.sourceLedgerScope;
    } else if (!reason || reason.length < 3) {
      throw new BadRequestException(
        "El saldo inicial o la corrección requieren un motivo",
      );
    }
    const correctionReason = mode === "account" ? null : (reason ?? null);
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
            sourceAccountId,
            sourceLedgerScope,
            correctionReason,
            idempotencyKey,
          },
        });
        await tx.pocketFundingLot.create({
          data: {
            householdId: actor.householdId,
            pocketId: pocket.id,
            sourceAccountId,
            sourceLedgerScope,
            contributorMemberId: actor.memberId,
            originalAmount: new Prisma.Decimal(amount.toString()),
            remainingAmount: new Prisma.Decimal(amount.toString()),
            currency: pocket.currency,
            origin: mode,
            reason: correctionReason,
          },
        });
        const updated = await tx.pocket.update({
          where: { id: pocket.id },
          data: {
            currentAmount: { increment: new Prisma.Decimal(amount.toString()) },
            version: { increment: 1 },
          },
        });
        if (sourceAccountId && sourceLedgerScope === "household") {
          const profile = await tx.accountProfile.findUnique({
            where: {
              householdId_ledgerScope_fireflyAccountId: {
                householdId: actor.householdId,
                ledgerScope: sourceLedgerScope,
                fireflyAccountId: sourceAccountId,
              },
            },
          });
          if (
            profile?.ownerMemberId &&
            profile.ownerMemberId !== actor.memberId
          ) {
            await tx.appNotification.create({
              data: {
                householdId: actor.householdId,
                recipientMemberId: profile.ownerMemberId,
                type: "partner_account_allocation",
                title: "Movimiento en una cuenta a tu nombre",
                message: `${amount.toString()} ${pocket.currency} fueron asignados por otro miembro del hogar`,
                entityType: "PocketEvent",
                entityId: event.id,
              },
            });
          }
        }
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

  async release(
    id: string,
    raw: {
      amount?: string;
      targetAccountId?: string;
      targetLedgerScope?: LedgerScope;
    },
    idempotencyKey: string,
    actor: Actor,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key es obligatorio");
    }
    const amount = new Prisma.Decimal(raw.amount ?? 0);
    if (!amount.greaterThan(0)) {
      throw new BadRequestException("La cantidad debe ser mayor que cero");
    }
    if (!raw.targetAccountId || !raw.targetLedgerScope) {
      throw new BadRequestException(
        "Selecciona la cuenta a la que regresa la disponibilidad",
      );
    }
    const pocket = await this.find(id, actor);
    this.assertOwner(pocket, actor);
    if (amount.greaterThan(pocket.currentAmount)) {
      throw new BadRequestException("El bolsillo no tiene saldo suficiente");
    }
    await this.accounts.assertAccount(
      raw.targetAccountId,
      raw.targetLedgerScope,
      actor,
    );
    await this.accounts.assertOwnedAccount(
      raw.targetAccountId,
      raw.targetLedgerScope,
      pocket.ownerMemberId,
      actor,
    );
    const targetAccountId = raw.targetAccountId;
    const targetLedgerScope = raw.targetLedgerScope;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lots = await tx.pocketFundingLot.findMany({
          where: {
            pocketId: pocket.id,
            sourceAccountId: targetAccountId,
            sourceLedgerScope: targetLedgerScope,
            remainingAmount: { gt: 0 },
          },
          orderBy: { createdAt: "asc" },
        });
        const traceable = lots.reduce(
          (sum, lot) => sum.plus(lot.remainingAmount),
          new Prisma.Decimal(0),
        );
        if (amount.greaterThan(traceable)) {
          throw new BadRequestException(
            "Ese monto no fue financiado por la cuenta seleccionada. Revisa el origen o concilia el saldo inicial",
          );
        }
        await this.consumeLots(tx, lots, amount);
        const event = await tx.pocketEvent.create({
          data: {
            householdId: actor.householdId,
            pocketId: pocket.id,
            actorMemberId: actor.memberId,
            type: "released",
            amount,
            currency: pocket.currency,
            planningOnly: true,
            sourceAccountId: targetAccountId,
            sourceLedgerScope: targetLedgerScope,
            idempotencyKey,
          },
        });
        const updated = await tx.pocket.update({
          where: { id: pocket.id },
          data: {
            currentAmount: { decrement: amount },
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

  private async consumeLots(
    tx: Prisma.TransactionClient,
    lots: Array<{ id: string; remainingAmount: Prisma.Decimal }>,
    requested: Prisma.Decimal,
  ) {
    let remaining = requested;
    for (const lot of lots) {
      if (!remaining.greaterThan(0)) break;
      const consumed = Prisma.Decimal.min(remaining, lot.remainingAmount);
      await tx.pocketFundingLot.update({
        where: { id: lot.id },
        data: { remainingAmount: { decrement: consumed } },
      });
      remaining = remaining.minus(consumed);
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
    this.assertOwner(source, actor);
    this.assertOwner(destination, actor);
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
        await this.moveFundingLots(
          tx,
          source.id,
          destination.id,
          new Prisma.Decimal(amount.toString()),
        );
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

  private async moveFundingLots(
    tx: Prisma.TransactionClient,
    sourcePocketId: string,
    destinationPocketId: string,
    requested: Prisma.Decimal,
  ) {
    const lots = await tx.pocketFundingLot.findMany({
      where: { pocketId: sourcePocketId, remainingAmount: { gt: 0 } },
      orderBy: { createdAt: "asc" },
    });
    const traceable = lots.reduce(
      (sum, lot) => sum.plus(lot.remainingAmount),
      new Prisma.Decimal(0),
    );
    if (requested.greaterThan(traceable)) {
      throw new BadRequestException(
        "El saldo debe conciliarse antes de moverlo a otro bolsillo",
      );
    }
    let remaining = requested;
    for (const lot of lots) {
      if (!remaining.greaterThan(0)) break;
      const moved = Prisma.Decimal.min(remaining, lot.remainingAmount);
      await tx.pocketFundingLot.update({
        where: { id: lot.id },
        data: { remainingAmount: { decrement: moved } },
      });
      await tx.pocketFundingLot.create({
        data: {
          householdId: lot.householdId,
          pocketId: destinationPocketId,
          sourceAccountId: lot.sourceAccountId,
          sourceLedgerScope: lot.sourceLedgerScope,
          contributorMemberId: lot.contributorMemberId,
          originalAmount: moved,
          remainingAmount: moved,
          currency: lot.currency,
          origin: "pocket_transfer",
          reason: `Transferido desde el bolsillo ${sourcePocketId}`,
        },
      });
      remaining = remaining.minus(moved);
    }
  }

  async linkAccount(
    id: string,
    raw: {
      accountId?: string;
      ledgerScope?: LedgerScope;
      version?: number;
    },
    actor: Actor,
  ) {
    const pocket = await this.find(id, actor);
    this.assertOwner(pocket, actor);
    if (!raw.accountId || !raw.ledgerScope) {
      throw new BadRequestException("Selecciona una cuenta para el bolsillo");
    }
    if (!Number.isInteger(raw.version) || Number(raw.version) < 1) {
      throw new BadRequestException(
        "Actualiza el bolsillo e inténtalo de nuevo",
      );
    }
    const accountId = raw.accountId;
    const ledgerScope = raw.ledgerScope;
    const version = raw.version as number;
    const availability = await this.accounts.availableForAllocation(
      accountId,
      ledgerScope,
      actor,
    );
    await this.accounts.assertOwnedAccount(
      accountId,
      ledgerScope,
      pocket.ownerMemberId,
      actor,
    );
    if (availability.account.currency !== pocket.currency) {
      throw new BadRequestException(
        "La cuenta y el bolsillo deben usar la misma moneda",
      );
    }
    const unreconciled = await this.prisma.pocketFundingLot.aggregate({
      where: {
        pocketId: pocket.id,
        sourceAccountId: null,
        remainingAmount: { gt: 0 },
      },
      _sum: { remainingAmount: true },
    });
    const amount = unreconciled._sum.remainingAmount ?? new Prisma.Decimal(0);
    if (amount.greaterThan(availability.availableAmount)) {
      throw new BadRequestException(
        `La cuenta no tiene disponibilidad suficiente para respaldar ${amount.toString()} ${pocket.currency}`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pocket.updateMany({
        where: { id: pocket.id, version },
        data: {
          defaultAccountId: accountId,
          defaultLedgerScope: ledgerScope,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          "El bolsillo cambió en otro dispositivo. Actualiza e inténtalo de nuevo",
        );
      }
      if (amount.greaterThan(0)) {
        await tx.pocketFundingLot.updateMany({
          where: {
            pocketId: pocket.id,
            sourceAccountId: null,
            remainingAmount: { gt: 0 },
          },
          data: {
            sourceAccountId: accountId,
            sourceLedgerScope: ledgerScope,
            origin: "legacy_reconciliation",
            reason: "Saldo legado vinculado por el creador del bolsillo",
          },
        });
      }
      const linked = await tx.pocket.findUniqueOrThrow({
        where: { id: pocket.id },
      });
      await tx.auditLog.create({
        data: {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          entityType: "Pocket",
          entityId: pocket.id,
          action: "account_linked",
          before: JSON.parse(JSON.stringify(pocket)) as Prisma.InputJsonValue,
          after: JSON.parse(JSON.stringify(linked)) as Prisma.InputJsonValue,
        },
      });
      return linked;
    });
  }

  async deleteCreatedByMistake(
    id: string,
    raw: { confirmation?: string; reason?: string },
    actor: Actor,
  ) {
    const pocket = await this.find(id, actor);
    this.assertOwner(pocket, actor);
    if (raw.confirmation !== "ELIMINAR") {
      throw new BadRequestException(
        "Escribe ELIMINAR para confirmar la eliminación definitiva",
      );
    }
    const reason = raw.reason?.trim();
    if (!reason || reason.length < 5 || reason.length > 500) {
      throw new BadRequestException(
        "Explica brevemente por qué el bolsillo fue creado por error",
      );
    }
    const [
      transactions,
      planAllocations,
      paymentOccurrences,
      investments,
      realEvents,
    ] = await Promise.all([
      this.prisma.transactionAttribution.count({
        where: { pocketId: pocket.id },
      }),
      this.prisma.planFundingAllocation.count({
        where: { pocketId: pocket.id },
      }),
      this.prisma.paymentOccurrence.count({
        where: { sourcePocketId: pocket.id },
      }),
      this.prisma.investmentPosition.count({
        where: { pocketId: pocket.id },
      }),
      this.prisma.pocketEvent.count({
        where: { pocketId: pocket.id, planningOnly: false },
      }),
    ]);
    if (
      transactions +
        planAllocations +
        paymentOccurrences +
        investments +
        realEvents >
      0
    ) {
      throw new BadRequestException(
        "Este bolsillo ya tiene movimientos o planes reales. Debes archivarlo para conservar la trazabilidad",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          entityType: "Pocket",
          entityId: pocket.id,
          action: "deleted_as_mistake",
          before: {
            ...JSON.parse(JSON.stringify(pocket)),
            deletionReason: reason,
          } as Prisma.InputJsonValue,
          after: { deleted: true, deletionReason: reason },
        },
      });
      await tx.pocket.delete({ where: { id: pocket.id } });
    });
    return { deleted: true, id: pocket.id };
  }
}
