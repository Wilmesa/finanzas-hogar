import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  matchImportedTransaction,
  transactionFingerprint,
} from "@finanzas/domain";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { PrismaService } from "./prisma.service.js";
import { TransactionRulesService } from "./transaction-rules.service.js";
import {
  TransactionsService,
  type CreateTransactionInput,
} from "./transactions.service.js";

export interface IOpenFinanceProvider {
  readonly name: string;
  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean;
  normalize(payload: unknown): Promise<ImportedTransactionInput[]>;
}

const importedTransactionSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  externalId: z.string().trim().min(1).max(255).optional(),
  status: z.enum(["pending", "posted"]).default("posted"),
  type: z.enum(["withdrawal", "deposit", "transfer"]),
  amount: z.string().refine((value) => Number(value) > 0),
  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase()),
  merchant: z.string().trim().min(1).max(255),
  occurredAt: z.iso.datetime(),
  sourceAccountId: z.string().min(1).optional(),
  destinationAccountId: z.string().min(1).optional(),
  payerMemberId: z.string().min(1).optional(),
});
export type ImportedTransactionInput = z.infer<
  typeof importedTransactionSchema
>;

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly rules: TransactionRulesService,
  ) {}

  async ingestFromProvider(
    provider: IOpenFinanceProvider,
    raw: unknown,
    headers: Record<string, string>,
    actor: Actor,
  ) {
    const serialized = JSON.stringify(raw);
    if (!provider.verifyWebhook(headers, serialized)) {
      throw new UnauthorizedException(`Firma inválida para ${provider.name}`);
    }
    const transactions = await provider.normalize(raw);
    const results = [];
    for (const transaction of transactions) {
      results.push(await this.ingest(transaction, actor));
    }
    return {
      provider: provider.name,
      received: transactions.length,
      results,
    };
  }

  async ingest(raw: unknown, actor: Actor) {
    const parsed = importedTransactionSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    this.validateAccounts(input);
    if (input.payerMemberId) {
      const payer = await this.prisma.member.findFirst({
        where: {
          id: input.payerMemberId,
          householdId: actor.householdId,
        },
      });
      if (!payer) throw new NotFoundException();
    }
    const fingerprint = transactionFingerprint({
      amount: input.amount,
      currency: input.currency,
      occurredAt: input.occurredAt,
      merchant: input.merchant,
    });
    const exact = input.externalId
      ? await this.prisma.importedTransaction.findFirst({
          where: {
            householdId: actor.householdId,
            provider: input.provider,
            externalId: input.externalId,
          },
          include: { attribution: true },
        })
      : null;
    if (exact) {
      const imported =
        exact.status === input.status
          ? exact
          : await this.prisma.importedTransaction.update({
              where: { id: exact.id },
              data: {
                status: input.status,
                rawPayload: {
                  bankStatus: input.status,
                  transactionType: input.type,
                },
              },
              include: { attribution: true },
            });
      return { imported, replayed: true, statusAdvanced: exact !== imported };
    }

    const fuzzy = await this.findFuzzyCandidate(input, actor);
    if (fuzzy) {
      const attribution = await this.prisma.transactionAttribution.update({
        where: { id: fuzzy.id },
        data: {
          externalTransactionId:
            input.externalId ?? fuzzy.externalTransactionId,
          importFingerprint: fingerprint,
          origin: "OPEN_FINANCE",
          transactionType: input.type,
          reviewStatus: "PENDING",
          syncStatus:
            fuzzy.syncStatus === "expected" ? "pending" : fuzzy.syncStatus,
        },
      });
      const priorImport = await this.prisma.importedTransaction.findFirst({
        where: {
          householdId: actor.householdId,
          attributionId: attribution.id,
        },
        orderBy: { createdAt: "desc" },
      });
      const data = {
        externalId: input.externalId ?? null,
        status: input.status === "posted" ? "synchronized" : "matched",
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        occurredAt: new Date(input.occurredAt),
        merchant: input.merchant,
        sourceAccountId: input.sourceAccountId ?? null,
        destinationAccountId: input.destinationAccountId ?? null,
        fingerprint,
        attributionId: attribution.id,
        rawPayload: {
          bankStatus: input.status,
          transactionType: input.type,
          previousExternalId: priorImport?.externalId ?? null,
        },
      } satisfies Prisma.ImportedTransactionUncheckedUpdateInput;
      const imported = priorImport
        ? await this.prisma.importedTransaction.update({
            where: { id: priorImport.id },
            data,
          })
        : await this.prisma.importedTransaction.create({
            data: {
              householdId: actor.householdId,
              provider: input.provider,
              ...data,
            },
          });
      return {
        imported,
        attribution,
        fuzzyMatched: true,
        statusAdvanced: input.status === "posted",
        fireflyCreated: false,
      };
    }

    const suggestion = await this.rules.suggest(
      {
        merchant: input.merchant,
        amount: input.amount,
        currency: input.currency,
        type: input.type,
      },
      actor,
    );
    const transactionInput: CreateTransactionInput = {
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      description: input.merchant,
      occurredAt: input.occurredAt,
      payerMemberId: input.payerMemberId ?? actor.memberId,
      ...(input.sourceAccountId ? { sourceId: input.sourceAccountId } : {}),
      ...(input.destinationAccountId
        ? { destinationId: input.destinationAccountId }
        : {}),
      ...(suggestion?.category ? { category: suggestion.category } : {}),
      ...(suggestion?.pocketId ? { pocketId: suggestion.pocketId } : {}),
    };
    const idempotencyKey = `open-finance:${input.provider}:${
      input.externalId ?? fingerprint
    }`;
    const attribution = await this.transactions.create(
      transactionInput,
      idempotencyKey,
      actor,
      {
        origin: "OPEN_FINANCE",
        reviewStatus: suggestion?.reviewStatus ?? "PENDING",
        importFingerprint: fingerprint,
        ...(input.externalId
          ? { externalTransactionId: input.externalId }
          : {}),
        ...(suggestion?.ruleId ? { appliedRuleId: suggestion.ruleId } : {}),
      },
    );
    const imported = await this.prisma.importedTransaction.create({
      data: {
        householdId: actor.householdId,
        provider: input.provider,
        externalId: input.externalId ?? null,
        status: "synchronized",
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        occurredAt: new Date(input.occurredAt),
        merchant: input.merchant,
        sourceAccountId: input.sourceAccountId ?? null,
        destinationAccountId: input.destinationAccountId ?? null,
        fingerprint,
        attributionId: attribution.id,
        rawPayload: {
          bankStatus: input.status,
          transactionType: input.type,
          appliedRuleId: suggestion?.ruleId ?? null,
        },
      },
    });
    return {
      imported,
      attribution,
      appliedRule: suggestion,
      bonusCandidate:
        input.type === "deposit"
          ? await this.detectExtraordinaryIncome(input, actor)
          : null,
      fireflyCreated: true,
    };
  }

  private validateAccounts(input: ImportedTransactionInput) {
    if (input.type === "withdrawal" && !input.sourceAccountId) {
      throw new BadRequestException("La importación requiere cuenta de origen");
    }
    if (input.type === "deposit" && !input.destinationAccountId) {
      throw new BadRequestException(
        "La importación requiere cuenta de destino",
      );
    }
    if (
      input.type === "transfer" &&
      (!input.sourceAccountId || !input.destinationAccountId)
    ) {
      throw new BadRequestException(
        "La importación requiere ambas cuentas para una transferencia",
      );
    }
  }

  private async findFuzzyCandidate(
    input: ImportedTransactionInput,
    actor: Actor,
  ) {
    const occurredAt = new Date(input.occurredAt);
    const from = new Date(occurredAt);
    from.setUTCDate(from.getUTCDate() - 3);
    const to = new Date(occurredAt);
    to.setUTCDate(to.getUTCDate() + 3);
    const candidates = await this.prisma.transactionAttribution.findMany({
      where: {
        householdId: actor.householdId,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        occurredAt: { gte: from, lte: to },
        OR: [
          { origin: { not: "MANUAL" } },
          { syncStatus: { in: ["pending", "failed", "expected"] } },
        ],
      },
      orderBy: { occurredAt: "desc" },
      take: 20,
    });
    return (
      candidates
        .map((candidate) => ({
          candidate,
          match: matchImportedTransaction(
            {
              amount: input.amount,
              currency: input.currency,
              occurredAt: input.occurredAt,
              merchant: input.merchant,
            },
            {
              amount: candidate.amount.toString(),
              currency: candidate.currency,
              occurredAt: candidate.occurredAt.toISOString(),
              merchant: candidate.merchant ?? "",
            },
          ),
        }))
        .filter(({ match }) => match.matches)
        .sort((left, right) => right.match.score - left.match.score)[0]
        ?.candidate ?? null
    );
  }

  private async detectExtraordinaryIncome(
    input: ImportedTransactionInput,
    actor: Actor,
  ) {
    const salary = await this.prisma.incomeSource.findFirst({
      where: {
        householdId: actor.householdId,
        kind: "salary",
        active: true,
        currency: input.currency,
        defaultAmount: { not: null },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (
      !salary?.defaultAmount ||
      Number(input.amount) <= Number(salary.defaultAmount) * 0.5
    ) {
      return null;
    }
    const plans = await this.prisma.financialPlan.findMany({
      where: {
        householdId: actor.householdId,
        currency: input.currency,
        status: { in: ["agreed", "active"] },
        allocations: {
          some: {
            expectedIncome: {
              source: {
                kind: { in: ["bonus_midyear", "bonus_endyear", "windfall"] },
              },
            },
          },
        },
      },
      select: { id: true, title: true, version: true, purpose: true },
      take: 5,
    });
    return {
      detected: true,
      reason: "El ingreso supera el 50 % del salario habitual configurado",
      plans,
      requiresConfirmation: true,
    };
  }
}
