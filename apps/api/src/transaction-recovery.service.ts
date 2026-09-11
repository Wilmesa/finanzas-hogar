import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Actor } from "./auth.js";
import { FireflyClient, type LedgerScope } from "./firefly.client.js";
import { PrismaService } from "./prisma.service.js";

/** Reconciles acknowledgements only. Never issues a second monetary POST. */
@Injectable()
export class TransactionRecoveryService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(TransactionRecoveryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly firefly: FireflyClient,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const members = await this.prisma.transactionAttribution.findMany({
        where: { syncStatus: { in: ["processing", "uncertain", "failed"] } },
        distinct: ["householdId", "payerMemberId"],
        select: { householdId: true, payerMemberId: true },
        take: 50,
      });
      for (const member of members)
        await this.reconcile({
          householdId: member.householdId,
          memberId: member.payerMemberId,
        });
    } catch {
      this.logger.warn(
        "Conciliación aplazada: no fue posible acceder a los servicios",
      );
    } finally {
      this.running = false;
    }
  }

  async reconcile(actor: Pick<Actor, "householdId" | "memberId">) {
    const cutoff = new Date(Date.now() - 120_000);
    const records = await this.prisma.transactionAttribution.findMany({
      where: {
        householdId: actor.householdId,
        syncStatus: { in: ["processing", "uncertain", "failed"] },
        AND: [
          {
            OR: [
              { ledgerScope: "household" },
              { ledgerScope: "private", payerMemberId: actor.memberId },
            ],
          },
          {
            OR: [
              { lastSyncAttemptAt: { lt: cutoff } },
              { lastSyncAttemptAt: null },
            ],
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    let recovered = 0;
    let requiresReview = 0;
    for (const record of records) {
      try {
        const scopes: LedgerScope[] =
          record.ledgerScope === "private"
            ? ["private", "household"]
            : ["household"];
        const matches: Array<{ id: string; scope: LedgerScope }> = [];
        for (const scope of scopes) {
          if (!this.firefly.hasToken(scope, record.payerMemberId)) continue;
          const found = await this.firefly.findTransactionByReference(
            `finanzas:${record.householdId}:${record.idempotencyKey}`,
            record.occurredAt.toISOString(),
            scope,
            record.payerMemberId,
            {
              amount: record.amount.toString(),
              currency: record.currency,
              type: record.transactionType,
              sourceId: record.sourceAccountId,
              destinationId: record.destinationAccountId,
            },
          );
          if (found) matches.push({ id: found.data.id, scope });
        }
        if (matches.length !== 1) {
          requiresReview++;
          continue;
        }
        const match = matches[0]!;
        const changed = await this.prisma.$transaction(async (tx) => {
          const claim = await tx.transactionAttribution.updateMany({
            where: {
              id: record.id,
              syncStatus: record.syncStatus,
              lastSyncAttemptAt: record.lastSyncAttemptAt,
            },
            data: {
              fireflyTransactionId: match.id,
              syncStatus: "synchronized",
              syncError: null,
              lastSyncAttemptAt: new Date(),
            },
          });
          if (!claim.count) return false;
          if (record.ledgerScope === "private" && match.scope === "household") {
            await tx.transactionAttribution.upsert({
              where: {
                householdId_idempotencyKey: {
                  householdId: record.householdId,
                  idempotencyKey: `${record.idempotencyKey}:household-redacted`,
                },
              },
              create: {
                householdId: record.householdId,
                idempotencyKey: `${record.idempotencyKey}:household-redacted`,
                ledgerScope: "household",
                payerMemberId: record.payerMemberId,
                fireflyTransactionId: match.id,
                merchant: "Asignación personal",
                amount: record.amount,
                currency: record.currency,
                transactionType: record.transactionType,
                occurredAt: record.occurredAt,
                syncStatus: "synchronized",
                reviewStatus: "REVIEWED",
              },
              update: {
                fireflyTransactionId: match.id,
                syncStatus: "synchronized",
                syncError: null,
              },
            });
          }
          await tx.auditLog.create({
            data: {
              householdId: record.householdId,
              actorMemberId: record.payerMemberId,
              entityType: "TransactionAttribution",
              entityId: record.id,
              action: "sync_recovered",
              after: { fireflyTransactionId: match.id },
            },
          });
          return true;
        });
        if (changed) recovered++;
      } catch {
        requiresReview++;
      }
    }
    return {
      examined: records.length,
      recovered,
      requiresReview,
      message:
        "La conciliación no crea movimientos nuevos. Los resultados no confirmados requieren revisión en Firefly antes de volver a registrar dinero.",
    };
  }
}
