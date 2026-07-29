import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Actor } from "./auth.js";
import { PrismaService } from "./prisma.service.js";

function dateOnly(value: string, endOfDay = false) {
  const parsed = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
  );
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("El rango de fechas no es válido");
  }
  return parsed;
}

function bogotaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async calendar(actor: Actor, from: string, to: string) {
    const start = dateOnly(from);
    const end = dateOnly(to, true);
    if (start > end) {
      throw new BadRequestException(
        "La fecha inicial debe ser anterior a la final",
      );
    }
    const [transactions, incomes, payments] = await Promise.all([
      this.prisma.transactionAttribution.findMany({
        where: {
          householdId: actor.householdId,
          occurredAt: { gte: start, lte: end },
          OR: [
            { ledgerScope: "household" },
            { ledgerScope: "private", payerMemberId: actor.memberId },
          ],
        },
        include: {
          payer: { select: { id: true, displayName: true, color: true } },
        },
        orderBy: { occurredAt: "asc" },
      }),
      this.prisma.expectedIncome.findMany({
        where: {
          householdId: actor.householdId,
          expectedDate: { gte: start, lte: end },
          source: {
            OR: [
              { visibility: "household" },
              { ownerMemberId: actor.memberId },
            ],
          },
        },
        include: {
          source: {
            include: {
              owner: {
                select: { id: true, displayName: true, color: true },
              },
            },
          },
        },
        orderBy: { expectedDate: "asc" },
      }),
      this.prisma.paymentOccurrence.findMany({
        where: {
          householdId: actor.householdId,
          dueDate: { gte: start, lte: end },
          paymentPlan: {
            OR: [
              { visibility: "household" },
              { ownerMemberId: actor.memberId },
            ],
          },
        },
        include: {
          paymentPlan: {
            include: {
              responsible: {
                select: { id: true, displayName: true, color: true },
              },
              owner: {
                select: { id: true, displayName: true, color: true },
              },
            },
          },
        },
        orderBy: { dueDate: "asc" },
      }),
    ]);
    return {
      range: { from, to },
      items: [
        ...transactions.map((transaction) => ({
          id: transaction.id,
          kind: "transaction" as const,
          date: transaction.occurredAt.toISOString().slice(0, 10),
          title: transaction.merchant ?? "Movimiento",
          amount: transaction.amount.toString(),
          currency: transaction.currency,
          status: transaction.syncStatus,
          member: transaction.payer,
          transactionType: transaction.transactionType,
          category: transaction.category,
          spendingNature: transaction.spendingNature,
        })),
        ...incomes.map((income) => ({
          id: income.id,
          kind: "expected_income" as const,
          date: income.expectedDate.toISOString().slice(0, 10),
          title: income.source.name,
          amount: (income.actualAmount ?? income.expectedAmount).toString(),
          currency: income.currency,
          status: income.status,
          member: income.source.owner,
          reason: income.reason,
        })),
        ...payments.map((occurrence) => ({
          id: occurrence.id,
          kind: "payment" as const,
          date: occurrence.dueDate.toISOString().slice(0, 10),
          title: occurrence.paymentPlan.name,
          amount:
            (
              occurrence.actualAmount ??
              occurrence.plannedAmount ??
              occurrence.paymentPlan.estimatedAmount ??
              occurrence.paymentPlan.totalAmount
            )?.toString() ?? null,
          currency: occurrence.paymentPlan.currency,
          status: occurrence.status,
          member:
            occurrence.paymentPlan.responsible ?? occurrence.paymentPlan.owner,
          paymentPlanId: occurrence.paymentPlanId,
        })),
      ].sort((left, right) => left.date.localeCompare(right.date)),
    };
  }

  async refreshNotifications(actor: Actor) {
    const today = bogotaToday();
    const start = dateOnly(today);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const [payments, incomes] = await Promise.all([
      this.prisma.paymentOccurrence.findMany({
        where: {
          householdId: actor.householdId,
          dueDate: { gte: start, lte: end },
          status: { in: ["planned", "due", "overdue"] },
          paymentPlan: {
            OR: [
              { visibility: "household" },
              { ownerMemberId: actor.memberId },
            ],
          },
        },
        include: { paymentPlan: true },
      }),
      this.prisma.expectedIncome.findMany({
        where: {
          householdId: actor.householdId,
          expectedDate: {
            gte: start,
            lt: new Date(start.getTime() + 86_400_000),
          },
          status: { in: ["planned", "confirmed"] },
          source: {
            OR: [
              { visibility: "household" },
              { ownerMemberId: actor.memberId },
            ],
          },
        },
        include: { source: true },
      }),
    ]);
    for (const occurrence of payments) {
      const recipient =
        occurrence.paymentPlan.responsibleMemberId ??
        occurrence.paymentPlan.ownerMemberId;
      if (recipient !== actor.memberId) continue;
      await this.createIfMissing({
        householdId: actor.householdId,
        recipientMemberId: recipient,
        type: "payment_due",
        title: "Pago pendiente",
        message: `${occurrence.paymentPlan.name} vence el ${occurrence.dueDate.toISOString().slice(0, 10)}`,
        entityType: "PaymentOccurrence",
        entityId: occurrence.id,
      });
    }
    for (const income of incomes) {
      if (income.source.ownerMemberId !== actor.memberId) continue;
      await this.createIfMissing({
        householdId: actor.householdId,
        recipientMemberId: actor.memberId,
        type: "income_confirmation",
        title: "Confirma el ingreso de hoy",
        message: `${income.source.name}: confirma la cantidad real y agrega observaciones si cambió`,
        entityType: "ExpectedIncome",
        entityId: income.id,
      });
    }
    return this.listNotifications(actor);
  }

  listNotifications(actor: Actor) {
    return this.prisma.appNotification.findMany({
      where: { recipientMemberId: actor.memberId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async readNotification(id: string, actor: Actor) {
    const notification = await this.prisma.appNotification.findFirst({
      where: { id, recipientMemberId: actor.memberId },
    });
    if (!notification) throw new NotFoundException();
    return this.prisma.appNotification.update({
      where: { id },
      data: { status: "read", readAt: new Date() },
    });
  }

  private async createIfMissing(input: {
    householdId: string;
    recipientMemberId: string;
    type: string;
    title: string;
    message: string;
    entityType: string;
    entityId: string;
  }) {
    const existing = await this.prisma.appNotification.findFirst({
      where: {
        recipientMemberId: input.recipientMemberId,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
      },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.appNotification.create({ data: input });
    }
  }
}
