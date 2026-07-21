import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canReadPocket, redactPrivateAllocation } from "@finanzas/domain";
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
}

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
    if (existing) return existing;

    const pocket = input.pocketId
      ? await this.prisma.pocket.findUnique({ where: { id: input.pocketId } })
      : null;
    if (input.pocketId && (!pocket || !canReadPocket(pocket, actor)))
      throw new NotFoundException();
    const scope = pocket?.visibility === "private" ? "private" : "household";

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

    if (scope === "private" && input.fundingSourceScope === "household") {
      await this.firefly.createTransaction(
        makePayload(
          redactPrivateAllocation(actor.displayName),
          `${idempotencyKey}:household-redacted`,
        ),
        "household",
        actor.memberId,
      );
    }
    const fireflyResult = await this.firefly.createTransaction(
      makePayload(input.description, idempotencyKey),
      scope,
      actor.memberId,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const attribution = await tx.transactionAttribution.create({
          data: {
            householdId: actor.householdId,
            fireflyTransactionId: fireflyResult.data.id,
            ledgerScope: scope,
            pocketId: pocket?.id ?? null,
            payerMemberId: actor.memberId,
            category: input.category ?? null,
            merchant: input.description,
            amount: new Prisma.Decimal(input.amount),
            currency: input.currency.toUpperCase(),
            occurredAt: new Date(input.occurredAt),
            idempotencyKey,
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
      throw error;
    }
  }
}
