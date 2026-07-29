import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canReadPocket } from "@finanzas/domain";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { AccountsService } from "./accounts.service.js";
import { FireflyClient } from "./firefly.client.js";
import { PrivateMetadataService } from "./private-metadata.service.js";
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
  spendingNature?: "household" | "personal";
}

export interface TransactionIngestionContext {
  origin: "MANUAL" | "FIREFLY_WEBHOOK" | "OPEN_FINANCE" | "OFFLINE_SYNC";
  reviewStatus?: "PENDING" | "REVIEWED" | "FLAGGED_FOR_PARTNER";
  externalTransactionId?: string;
  importFingerprint?: string;
  appliedRuleId?: string;
  ledgerScope?: "household" | "private";
}

const TransactionPatch = z
  .object({
    merchant: z.string().trim().min(1).max(255).optional(),
    category: z.string().trim().min(1).max(100).nullable().optional(),
    spendingNature: z.enum(["household", "personal"]).optional(),
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
    private readonly privateMetadata: PrivateMetadataService = new PrivateMetadataService(),
    private readonly accounts?: AccountsService,
  ) {}

  async list(actor: Actor) {
    const [transactions, reversalAudits] = await Promise.all([
      this.prisma.transactionAttribution.findMany({
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
      }),
      this.prisma.auditLog.findMany({
        where: {
          householdId: actor.householdId,
          entityType: "TransactionAttribution",
          action: "reversed",
        },
        select: { entityId: true, after: true },
      }),
    ]);
    const reversedIds = new Set(reversalAudits.map((audit) => audit.entityId));
    const reversalIds = new Set(
      reversalAudits.flatMap((audit) => {
        const after = audit.after as { reversalId?: unknown } | null;
        return typeof after?.reversalId === "string" ? [after.reversalId] : [];
      }),
    );
    return transactions.map((transaction) => {
      const correctionAllowedUntil = new Date(
        transaction.occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000,
      );
      const correctionState = {
        correctionAllowedUntil,
        canCorrect: correctionAllowedUntil.getTime() >= Date.now(),
        canReverse:
          correctionAllowedUntil.getTime() >= Date.now() &&
          transaction.syncStatus === "synchronized" &&
          !reversedIds.has(transaction.id) &&
          !reversalIds.has(transaction.id),
        reversed: reversedIds.has(transaction.id),
        isReversal: reversalIds.has(transaction.id),
      };
      if (
        transaction.ledgerScope !== "private" ||
        transaction.payerMemberId !== actor.memberId ||
        !transaction.privateMetadataCiphertext
      ) {
        return { ...transaction, ...correctionState };
      }
      const metadata = this.privateMetadata.open<{
        merchant?: string;
        category?: string;
      }>(transaction.privateMetadataCiphertext);
      return {
        ...transaction,
        merchant: metadata.merchant ?? transaction.merchant,
        category: metadata.category ?? transaction.category,
        privateMetadataCiphertext: undefined,
        ...correctionState,
      };
    });
  }

  async reviewQueue(actor: Actor) {
    const transactions = await this.prisma.transactionAttribution.findMany({
      where: {
        householdId: actor.householdId,
        reviewStatus: { in: ["PENDING", "FLAGGED_FOR_PARTNER"] },
        OR: [
          { ledgerScope: "household" },
          { ledgerScope: "private", payerMemberId: actor.memberId },
        ],
      },
      include: {
        payer: { select: { id: true, displayName: true, color: true } },
        pocket: { select: { id: true, name: true, visibility: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    return transactions.map((transaction) => {
      if (
        transaction.ledgerScope !== "private" ||
        transaction.payerMemberId !== actor.memberId ||
        !transaction.privateMetadataCiphertext
      ) {
        return transaction;
      }
      const metadata = this.privateMetadata.open<{
        merchant?: string;
        category?: string | null;
      }>(transaction.privateMetadataCiphertext);
      return {
        ...transaction,
        merchant: metadata.merchant ?? transaction.merchant,
        category: metadata.category ?? transaction.category,
        privateMetadataCiphertext: undefined,
      };
    });
  }

  async create(
    input: CreateTransactionInput,
    idempotencyKey: string,
    actor: Actor,
    ingestion?: TransactionIngestionContext,
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
    const scope =
      ingestion?.ledgerScope ??
      (pocket?.visibility === "private"
        ? "private"
        : (input.fundingSourceScope ?? "household"));
    const payerMemberId = input.payerMemberId ?? actor.memberId;
    if (scope === "private" && payerMemberId !== actor.memberId) {
      throw new BadRequestException(
        "Un movimiento privado solo puede registrarse a tu nombre",
      );
    }
    const payer = await this.prisma.member.findFirst({
      where: { id: payerMemberId, householdId: actor.householdId },
      select: { id: true },
    });
    if (!payer)
      throw new BadRequestException("El pagador no pertenece al hogar");

    const fireflyScope =
      scope === "private" && input.fundingSourceScope === "household"
        ? "household"
        : scope;
    if (
      input.type === "withdrawal" &&
      (!ingestion ||
        ingestion.origin === "MANUAL" ||
        ingestion.origin === "OFFLINE_SYNC") &&
      input.sourceId &&
      this.accounts
    ) {
      await this.accounts.assertPrimaryExpenseAccount(
        input.sourceId,
        fireflyScope,
        actor,
      );
    }
    const availableAccounts = await this.firefly.listAssetAccounts(
      fireflyScope,
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

    const pending = await this.prisma.transactionAttribution.upsert({
      where: {
        householdId_idempotencyKey: {
          householdId: actor.householdId,
          idempotencyKey,
        },
      },
      update: {},
      create: {
        householdId: actor.householdId,
        fireflyTransactionId: null,
        ledgerScope: scope,
        pocketId: pocket?.id ?? null,
        payerMemberId,
        category: scope === "private" ? null : (input.category ?? null),
        merchant: scope === "private" ? "Consumo Personal" : input.description,
        amount: new Prisma.Decimal(input.amount),
        transactionType: input.type,
        spendingNature: input.spendingNature ?? "household",
        sourceAccountId: input.sourceId ?? null,
        destinationAccountId: input.destinationId ?? null,
        currency: input.currency.toUpperCase(),
        occurredAt: new Date(input.occurredAt),
        idempotencyKey,
        syncStatus: "pending",
        reviewStatus:
          ingestion?.reviewStatus ?? (ingestion ? "PENDING" : "REVIEWED"),
        origin: ingestion?.origin ?? "MANUAL",
        externalTransactionId: ingestion?.externalTransactionId ?? null,
        importFingerprint: ingestion?.importFingerprint ?? null,
        privateMetadataCiphertext:
          scope === "private"
            ? this.privateMetadata.seal({
                merchant: input.description,
                category: input.category ?? null,
              })
            : null,
        lastSyncAttemptAt: new Date(),
      },
    });
    const claim = await this.prisma.transactionAttribution.updateMany({
      where: {
        id: pending.id,
        syncStatus: { in: ["pending", "failed"] },
      },
      data: {
        syncStatus: "processing",
        syncError: null,
        lastSyncAttemptAt: new Date(),
      },
    });
    if (claim.count === 0) {
      return this.prisma.transactionAttribution.findUniqueOrThrow({
        where: { id: pending.id },
      });
    }

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
              ? description
              : undefined,
          category_name: scope === "private" ? undefined : input.category,
          tags:
            scope === "private"
              ? ["okle-private"]
              : pocket
                ? [`okle-pocket:${pocket.id}`, `okle-purpose:${pocket.purpose}`]
                : ["okle-unassigned"],
          external_id: externalId,
          internal_reference: `finanzas:${actor.householdId}:${idempotencyKey}`,
        },
      ],
    });

    let fireflyResult: { data: { id: string } };
    try {
      fireflyResult = await this.firefly.createTransaction(
        makePayload(
          scope === "private" ? "Consumo Personal" : input.description,
          idempotencyKey,
        ),
        fireflyScope,
        payerMemberId,
      );
      return await this.prisma.$transaction(async (tx) => {
        if (scope === "private" && input.fundingSourceScope === "household") {
          await tx.transactionAttribution.upsert({
            where: {
              householdId_idempotencyKey: {
                householdId: actor.householdId,
                idempotencyKey: `${idempotencyKey}:household-redacted`,
              },
            },
            create: {
              householdId: actor.householdId,
              fireflyTransactionId: fireflyResult.data.id,
              ledgerScope: "household",
              pocketId: null,
              payerMemberId,
              category: null,
              merchant: "Asignación personal",
              amount: new Prisma.Decimal(input.amount),
              transactionType: input.type,
              currency: input.currency.toUpperCase(),
              occurredAt: new Date(input.occurredAt),
              idempotencyKey: `${idempotencyKey}:household-redacted`,
              syncStatus: "synchronized",
              reviewStatus: "REVIEWED",
              origin: ingestion?.origin ?? "MANUAL",
              lastSyncAttemptAt: new Date(),
            },
            update: {
              fireflyTransactionId: fireflyResult.data.id,
              syncStatus: "synchronized",
              syncError: null,
              lastSyncAttemptAt: new Date(),
            },
          });
        }
        const attribution = await tx.transactionAttribution.update({
          where: { id: pending.id },
          data: {
            fireflyTransactionId: fireflyResult.data.id,
            syncStatus: "synchronized",
            syncError: null,
            lastSyncAttemptAt: new Date(),
          },
        });
        if (input.sourceId && fireflyScope === "household") {
          const accountProfile = await tx.accountProfile.findUnique({
            where: {
              householdId_ledgerScope_fireflyAccountId: {
                householdId: actor.householdId,
                ledgerScope: "household",
                fireflyAccountId: input.sourceId,
              },
            },
          });
          if (
            accountProfile?.ownerMemberId &&
            accountProfile.ownerMemberId !== actor.memberId
          ) {
            await tx.appNotification.create({
              data: {
                householdId: actor.householdId,
                recipientMemberId: accountProfile.ownerMemberId,
                type: "partner_account_spending",
                title: "Movimiento en una cuenta a tu nombre",
                message: `${input.amount} ${input.currency.toUpperCase()} fueron registrados por otro miembro del hogar`,
                entityType: "TransactionAttribution",
                entityId: attribution.id,
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
        const repeated = await this.prisma.transactionAttribution.findUnique({
          where: {
            householdId_idempotencyKey: {
              householdId: actor.householdId,
              idempotencyKey,
            },
          },
        });
        if (repeated) return repeated;
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
    const correctionAllowedUntil = new Date(
      existing.occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    if (correctionAllowedUntil.getTime() < Date.now()) {
      throw new BadRequestException(
        "El plazo de corrección de siete días ya terminó",
      );
    }
    const priorPrivateMetadata =
      existing.privateMetadataCiphertext &&
      existing.ledgerScope === "private" &&
      existing.payerMemberId === actor.memberId
        ? this.privateMetadata.open<{
            merchant?: string;
            category?: string | null;
          }>(existing.privateMetadataCiphertext)
        : null;
    const privateMetadata =
      existing.ledgerScope === "private" &&
      existing.payerMemberId === actor.memberId
        ? this.privateMetadata.seal({
            merchant:
              parsed.data.merchant ??
              priorPrivateMetadata?.merchant ??
              existing.merchant,
            category:
              parsed.data.category ??
              priorPrivateMetadata?.category ??
              existing.category,
          })
        : null;
    const updated = await this.prisma.transactionAttribution.update({
      where: { id },
      data: {
        ...(parsed.data.merchant !== undefined &&
        existing.ledgerScope !== "private"
          ? { merchant: parsed.data.merchant }
          : {}),
        ...(parsed.data.category !== undefined &&
        existing.ledgerScope !== "private"
          ? { category: parsed.data.category }
          : {}),
        ...(parsed.data.spendingNature !== undefined
          ? { spendingNature: parsed.data.spendingNature }
          : {}),
        ...(privateMetadata
          ? { privateMetadataCiphertext: privateMetadata }
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

  async reverse(id: string, idempotencyKey: string, actor: Actor) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key es obligatorio");
    }
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
    const deadline = existing.occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000;
    if (deadline < Date.now()) {
      throw new BadRequestException(
        "El plazo de siete días para revertir este movimiento terminó",
      );
    }
    if (existing.syncStatus !== "synchronized") {
      throw new BadRequestException(
        "Solo se puede revertir un movimiento sincronizado",
      );
    }
    const previousReversal = await this.prisma.auditLog.findFirst({
      where: {
        householdId: actor.householdId,
        entityType: "TransactionAttribution",
        entityId: existing.id,
        action: "reversed",
      },
    });
    if (previousReversal) {
      const after = previousReversal.after as {
        reversalId?: unknown;
      } | null;
      return {
        originalId: existing.id,
        reversalId:
          typeof after?.reversalId === "string" ? after.reversalId : null,
        replayed: true,
      };
    }

    const type =
      existing.transactionType === "withdrawal"
        ? "deposit"
        : existing.transactionType === "deposit"
          ? "withdrawal"
          : existing.transactionType === "transfer"
            ? "transfer"
            : null;
    if (!type) {
      throw new BadRequestException(
        "El tipo de movimiento no admite reversión automática",
      );
    }
    const sourceId =
      type === "withdrawal"
        ? (existing.destinationAccountId ?? undefined)
        : type === "transfer"
          ? (existing.destinationAccountId ?? undefined)
          : undefined;
    const destinationId =
      type === "deposit"
        ? (existing.sourceAccountId ?? undefined)
        : type === "transfer"
          ? (existing.sourceAccountId ?? undefined)
          : undefined;
    if (
      (type === "withdrawal" && !sourceId) ||
      (type === "deposit" && !destinationId) ||
      (type === "transfer" && (!sourceId || !destinationId))
    ) {
      throw new BadRequestException(
        "El movimiento original no conserva cuentas suficientes para revertirlo",
      );
    }

    const reversal = await this.create(
      {
        type,
        amount: existing.amount.toString(),
        currency: existing.currency,
        description: `Reversión: ${existing.merchant ?? "movimiento"}`,
        ...(sourceId ? { sourceId } : {}),
        ...(destinationId ? { destinationId } : {}),
        ...(existing.category ? { category: existing.category } : {}),
        occurredAt: new Date().toISOString(),
        fundingSourceScope: existing.ledgerScope,
        payerMemberId: existing.payerMemberId,
        spendingNature: existing.spendingNature,
      },
      `reversal:${existing.id}`,
      actor,
    );
    await this.prisma.auditLog.create({
      data: {
        householdId: actor.householdId,
        actorMemberId: actor.memberId,
        entityType: "TransactionAttribution",
        entityId: existing.id,
        action: "reversed",
        before: {
          transactionType: existing.transactionType,
          amount: existing.amount.toString(),
          currency: existing.currency,
        },
        after: {
          reversalId: reversal?.id ?? null,
          commandIdempotencyKey: idempotencyKey,
        },
      },
    });
    return {
      originalId: existing.id,
      reversalId: reversal?.id ?? null,
      replayed: false,
    };
  }

  async review(id: string, raw: unknown, idempotencyKey: string, actor: Actor) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key es obligatorio");
    }
    const parsed = z
      .object({
        status: z.enum(["REVIEWED", "FLAGGED_FOR_PARTNER"]),
        category: z.string().trim().min(1).max(100).optional(),
        pocketId: z.string().uuid().nullable().optional(),
        flaggedForMemberId: z.string().min(1).optional(),
      })
      .safeParse(raw);
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
    if (parsed.data.flaggedForMemberId) {
      const partner = await this.prisma.member.findFirst({
        where: {
          id: parsed.data.flaggedForMemberId,
          householdId: actor.householdId,
        },
      });
      if (!partner) throw new NotFoundException();
    }
    const pocket = parsed.data.pocketId
      ? await this.prisma.pocket.findFirst({
          where: {
            id: parsed.data.pocketId,
            householdId: actor.householdId,
            currency: existing.currency,
            OR: [
              { visibility: "household" },
              { ownerMemberId: actor.memberId },
            ],
          },
        })
      : null;
    if (parsed.data.pocketId && !pocket) throw new NotFoundException();
    const priorPrivateMetadata =
      existing.ledgerScope === "private" &&
      existing.payerMemberId === actor.memberId &&
      existing.privateMetadataCiphertext
        ? this.privateMetadata.open<{
            merchant?: string;
            category?: string | null;
          }>(existing.privateMetadataCiphertext)
        : null;
    const privateMetadata =
      existing.ledgerScope === "private" && parsed.data.category !== undefined
        ? this.privateMetadata.seal({
            merchant: priorPrivateMetadata?.merchant ?? "Consumo Personal",
            category: parsed.data.category,
          })
        : null;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.transactionAttribution.update({
        where: { id: existing.id },
        data: {
          reviewStatus: parsed.data.status,
          reviewedAt: parsed.data.status === "REVIEWED" ? new Date() : null,
          reviewedByMemberId:
            parsed.data.status === "REVIEWED" ? actor.memberId : null,
          flaggedForMemberId:
            parsed.data.status === "FLAGGED_FOR_PARTNER"
              ? (parsed.data.flaggedForMemberId ?? null)
              : null,
          ...(parsed.data.category !== undefined
            ? {
                category:
                  existing.ledgerScope === "private"
                    ? null
                    : parsed.data.category,
              }
            : {}),
          ...(privateMetadata
            ? { privateMetadataCiphertext: privateMetadata }
            : {}),
          ...(parsed.data.pocketId !== undefined
            ? { pocketId: parsed.data.pocketId }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          entityType: "TransactionAttribution",
          entityId: id,
          action:
            parsed.data.status === "REVIEWED"
              ? "reviewed"
              : "flagged_for_partner",
          before: JSON.parse(JSON.stringify(existing)) as Prisma.InputJsonValue,
          after: JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  async rotatePrivateMetadata(idempotencyKey: string, actor: Actor) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key es obligatorio");
    }
    const prior = await this.prisma.auditLog.findFirst({
      where: {
        householdId: actor.householdId,
        actorMemberId: actor.memberId,
        entityType: "PrivateMetadataKeyring",
        entityId: idempotencyKey,
        action: "reencrypted",
      },
    });
    if (prior) {
      return {
        activeKeyId: this.privateMetadata.activeKeyId(),
        replayed: true,
      };
    }
    const records = await this.prisma.transactionAttribution.findMany({
      where: {
        householdId: actor.householdId,
        payerMemberId: actor.memberId,
        ledgerScope: "private",
        privateMetadataCiphertext: { not: null },
      },
      select: { id: true, privateMetadataCiphertext: true },
    });
    const pending = records.filter(
      (record): record is { id: string; privateMetadataCiphertext: string } =>
        Boolean(
          record.privateMetadataCiphertext &&
          this.privateMetadata.needsRotation(record.privateMetadataCiphertext),
        ),
    );
    await this.prisma.$transaction(async (tx) => {
      for (const record of pending) {
        await tx.transactionAttribution.update({
          where: { id: record.id },
          data: {
            privateMetadataCiphertext: this.privateMetadata.rotate(
              record.privateMetadataCiphertext,
            ),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          entityType: "PrivateMetadataKeyring",
          entityId: idempotencyKey,
          action: "reencrypted",
          after: {
            activeKeyId: this.privateMetadata.activeKeyId(),
            recordsRotated: pending.length,
          },
        },
      });
    });
    return {
      activeKeyId: this.privateMetadata.activeKeyId(),
      recordsRotated: pending.length,
      replayed: false,
    };
  }
}
