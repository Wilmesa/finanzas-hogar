import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canReadPocket, redactPrivateAllocation } from "@finanzas/domain";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { FireflyClient } from "./firefly.client.js";
import { PrismaService } from "./prisma.service.js";

export interface CreateTransactionInput {
  type: "withdrawal" | "deposit" | "transfer";
  amount: string;
  currency: string;
  description: string;
  sourceId?: string;
  destinationId?: string;
  category?: string;
  pocketId?: string;
  occurredAt: string;
  fundingSourceScope?: "household" | "private";
  payerMemberId?: string;
}

const TransactionPatch = z
  .object({
    merchant: z.string().trim().min(1).max(255).optional(),
    category: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Debes enviar al menos un cambio",
  );

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firefly: FireflyClient,
  ) {}

  async list(actor: Actor) {
    return this.prisma.transactionAttribution.findMany({
      where: {
        householdId: actor.householdId,
        OR: [
          { ledgerScope: "household" },
          { ledgerScope: "private", payerMemberId: actor.memberId },
        ],
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
      include: {
        payer: { select: { id: true, displayName: true, color: true } },
      },
    });
  }

  async create(
    input: CreateTransactionInput,
    idempotencyKey: string,
    actor: Actor,
  ) {
    if (!idempotencyKey)
      throw new BadRequestException("Idempotency-Key es obligatorio");
    if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) {
      throw new BadRequestException("La cantidad debe ser mayor que cero");
    }
    if (!input.description?.trim()) {
      throw new BadRequestException("La descripción es obligatoria");
    }
    if (Number.isNaN(new Date(input.occurredAt).getTime())) {
      throw new BadRequestException("La fecha del movimiento no es válida");
    }
    if (input.type === "withdrawal" && !input.sourceId) {
      throw new BadRequestException("Selecciona la cuenta de origen");
    }
    if (input.type === "deposit" && !input.destinationId) {
      throw new BadRequestException("Selecciona la cuenta de destino");
    }
    if (
      input.type === "transfer" &&
      (!input.sourceId || !input.destinationId)
    ) {
      throw new BadRequestException("Una transferencia requiere ambas cuentas");
    }
    const existing = await this.prisma.transactionAttribution.findUnique({
      where: {
        householdId_idempotencyKey: {
          householdId: actor.householdId,
          idempotencyKey,
        },
      },
    });
    if (existing?.syncStatus === "synchronized") return existing;

    const pocket = input.pocketId
      ? await this.prisma.pocket.findUnique({ where: { id: input.pocketId } })
      : null;
    if (input.pocketId && (!pocket || !canReadPocket(pocket, actor)))
      throw new NotFoundException();
    const scope = pocket?.visibility === "private" ? "private" : "household";
    const payerMemberId = input.payerMemberId ?? actor.memberId;
    if (scope === "private" && payerMemberId !== actor.memberId) {
      throw new BadRequestException(
        "Un movimiento privado solo puede registrarse a tu nombre",
      );
    }
    const payer = await this.prisma.member.findFirst({
      where: { id: payerMemberId, householdId: actor.householdId },
      select: { id: true, displayName: true },
    });
    if (!payer)
      throw new BadRequestException("El pagador no pertenece al hogar");

    const availableAccounts = await this.firefly.listAssetAccounts(
      scope,
      payerMemberId,
    );
    const accountIds = new Set(availableAccounts.map((account) => account.id));
    if (input.sourceId && !accountIds.has(input.sourceId)) {
      throw new BadRequestException(
        "La cuenta de origen no pertenece al libro seleccionado",
      );
    }
    if (input.destinationId && !accountIds.has(input.destinationId)) {
      throw new BadRequestException(
        "La cuenta de destino no pertenece al libro seleccionado",
      );
    }

    const pending =
      existing ??
      (await this.prisma.transactionAttribution.create({
        data: {
          householdId: actor.householdId,
          fireflyTransactionId: null,
          ledgerScope: scope,
          pocketId: pocket?.id ?? null,
          payerMemberId,
          category: input.category ?? null,
          merchant: input.description,
          amount: new Prisma.Decimal(input.amount),
          currency: input.currency.toUpperCase(),
          occurredAt: new Date(input.occurredAt),
          idempotencyKey,
          syncStatus: "pending",
          lastSyncAttemptAt: new Date(),
        },
      }));

    const makePayload = (description: string, externalId: string) => ({
      error_if_duplicate_hash: false,
      apply_rules: true,
      fire_webhooks: true,
      transactions: [
        {
          type: input.type,
          date: input.occurredAt,
          amount: input.amount,
          description,
          currency_code: input.currency.toUpperCase(),
          source_id: input.sourceId,
          destination_id: input.destinationId,
          destination_name:
            input.type === "withdrawal" && !input.destinationId
              ? input.description
              : undefined,
          category_name: input.category,
          external_id: externalId,
          internal_reference: `finanzas:${actor.householdId}:${idempotencyKey}`,
        },
      ],
    });

    let fireflyResult: { data: { id: string } };
    try {
      if (scope === "private" && input.fundingSourceScope === "household") {
        const redactedResult = await this.firefly.createTransaction(
          makePayload(
            redactPrivateAllocation(payer.displayName),
            `${idempotencyKey}:household-redacted`,
          ),
          "household",
          payerMemberId,
        );
        await this.prisma.transactionAttribution.upsert({
          where: {
            householdId_idempotencyKey: {
              householdId: actor.householdId,
              idempotencyKey: `${idempotencyKey}:household-redacted`,
            },
          },
          create: {
            householdId: actor.householdId,
            fireflyTransactionId: redactedResult.data.id,
            ledgerScope: "household",
            pocketId: null,
            payerMemberId,
            category: null,
            merchant: redactPrivateAllocation(payer.displayName),
            amount: new Prisma.Decimal(input.amount),
            currency: input.currency.toUpperCase(),
            occurredAt: new Date(input.occurredAt),
            idempotencyKey: `${idempotencyKey}:household-redacted`,
            syncStatus: "synchronized",
            lastSyncAttemptAt: new Date(),
          },
          update: {
            fireflyTransactionId: redactedResult.data.id,
            syncStatus: "synchronized",
            syncError: null,
            lastSyncAttemptAt: new Date(),
          },
        });
      }
      fireflyResult = await this.firefly.createTransaction(
        makePayload(input.description, idempotencyKey),
        scope,
        payerMemberId,
      );
      return await this.prisma.$transaction(async (tx) => {
        const attribution = await tx.transactionAttribution.update({
          where: { id: pending.id },
          data: {
            fireflyTransactionId: fireflyResult.data.id,
            syncStatus: "synchronized",
            syncError: null,
            lastSyncAttemptAt: new Date(),
          },
        });
        if (pocket) {
          const eventType =
            input.type === "withdrawal"
              ? "spent"
              : input.type === "deposit"
                ? "allocated"
                : "adjusted";
          await tx.pocketEvent.create({
            data: {
              householdId: actor.householdId,
              pocketId: pocket.id,
              actorMemberId: actor.memberId,
              type: eventType,
              amount: new Prisma.Decimal(input.amount),
              currency: input.currency.toUpperCase(),
              planningOnly: false,
              fireflyTransactionId: fireflyResult.data.id,
              idempotencyKey,
            },
          });
          if (input.type !== "transfer") {
            await tx.pocket.update({
              where: { id: pocket.id },
              data: {
                currentAmount:
                  input.type === "withdrawal"
                    ? { decrement: new Prisma.Decimal(input.amount) }
                    : { increment: new Prisma.Decimal(input.amount) },
                version: { increment: 1 },
              },
            });
          }
        }
        return attribution;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Esta operación ya fue procesada");
      }
      await this.prisma.transactionAttribution.update({
        where: { id: pending.id },
        data: {
          syncStatus: "failed",
          syncError: "No fue posible sincronizar con el libro contable",
          lastSyncAttemptAt: new Date(),
        },
      });
      throw error;
    }
  }

  async update(id: string, raw: unknown, actor: Actor) {
    const parsed = TransactionPatch.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const existing = await this.prisma.transactionAttribution.findFirst({
      where: {
        id,
        householdId: actor.householdId,
        OR: [
          { ledgerScope: "household" },
          { ledgerScope: "private", payerMemberId: actor.memberId },
        ],
      },
    });
    if (!existing) throw new NotFoundException();
    const updated = await this.prisma.transactionAttribution.update({
      where: { id },
      data: {
        ...(parsed.data.merchant !== undefined
          ? { merchant: parsed.data.merchant }
          : {}),
        ...(parsed.data.category !== undefined
          ? { category: parsed.data.category }
          : {}),
      },
      include: {
        payer: { select: { id: true, displayName: true, color: true } },
      },
    });
    await this.prisma.auditLog.create({
      data: {
        householdId: actor.householdId,
        actorMemberId: actor.memberId,
        entityType: "TransactionAttribution",
        entityId: id,
        action: "corrected",
        before: JSON.parse(JSON.stringify(existing)) as Prisma.InputJsonValue,
        after: JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonValue,
      },
    });
    return updated;
  }
}
