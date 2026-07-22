import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { PrismaService } from "./prisma.service.js";

const dateOnly = z.iso.date();
const money = z
  .string()
  .refine((value) => Number(value) > 0, "Cantidad inválida");
const safeUrl = z
  .url()
  .max(2048)
  .refine((value) => ["https:", "http:"].includes(new URL(value).protocol), {
    message: "El enlace debe usar HTTP o HTTPS",
  });
const paymentInput = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  visibility: z.enum(["household", "private"]).default("household"),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  totalAmount: money.optional(),
  estimatedAmount: money.optional(),
  recurrence: z
    .enum([
      "once",
      "weekly",
      "biweekly",
      "monthly",
      "quarterly",
      "annual",
      "custom",
    ])
    .default("monthly"),
  dueDay: z.number().int().min(1).max(31).optional(),
  nextDueDate: dateOnly.optional(),
  paymentUrl: safeUrl.optional(),
  reference: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(1000).optional(),
});
const paymentPatch = paymentInput.partial().extend({
  status: z.enum(["active", "completed", "archived"]).optional(),
});
const occurrenceInput = z.object({
  dueDate: dateOnly,
  plannedAmount: money.optional(),
  note: z.string().trim().max(500).optional(),
});
const paidInput = z.object({
  actualAmount: money,
  sourcePocketId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private visible(actor: Actor) {
    return {
      householdId: actor.householdId,
      OR: [
        { visibility: "household" as const },
        { ownerMemberId: actor.memberId },
      ],
    };
  }

  list(actor: Actor) {
    return this.prisma.paymentPlan.findMany({
      where: { ...this.visible(actor), status: { not: "archived" } },
      include: { occurrences: { orderBy: { dueDate: "asc" } } },
      orderBy: [{ nextDueDate: "asc" }, { updatedAt: "desc" }],
    });
  }

  async dueCount(actor: Actor) {
    const limit = new Date();
    limit.setUTCDate(limit.getUTCDate() + 7);
    const count = await this.prisma.paymentOccurrence.count({
      where: {
        householdId: actor.householdId,
        status: "planned",
        dueDate: { lte: limit },
        paymentPlan: {
          status: "active",
          OR: [{ visibility: "household" }, { ownerMemberId: actor.memberId }],
        },
      },
    });
    return { count };
  }

  async create(raw: unknown, actor: Actor) {
    const parsed = paymentInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    return this.prisma.paymentPlan.create({
      data: {
        householdId: actor.householdId,
        ownerMemberId: actor.memberId,
        name: input.name,
        type: input.type,
        visibility: input.visibility,
        currency: input.currency,
        recurrence: input.recurrence,
        dueDay: input.dueDay ?? null,
        paymentUrl: input.paymentUrl ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        totalAmount: input.totalAmount
          ? new Prisma.Decimal(input.totalAmount)
          : null,
        estimatedAmount: input.estimatedAmount
          ? new Prisma.Decimal(input.estimatedAmount)
          : null,
        nextDueDate: input.nextDueDate
          ? new Date(`${input.nextDueDate}T00:00:00Z`)
          : null,
        ...(input.nextDueDate
          ? {
              occurrences: {
                create: {
                  householdId: actor.householdId,
                  dueDate: new Date(`${input.nextDueDate}T00:00:00Z`),
                  plannedAmount: input.estimatedAmount
                    ? new Prisma.Decimal(input.estimatedAmount)
                    : null,
                },
              },
            }
          : {}),
      },
      include: { occurrences: true },
    });
  }

  async update(id: string, raw: unknown, actor: Actor) {
    const existing = await this.find(id, actor);
    if (existing.ownerMemberId !== actor.memberId && actor.role !== "owner")
      throw new NotFoundException();
    const parsed = paymentPatch.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    await this.prisma.paymentPlan.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.visibility !== undefined
          ? { visibility: input.visibility }
          : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.recurrence !== undefined
          ? { recurrence: input.recurrence }
          : {}),
        ...(input.dueDay !== undefined ? { dueDay: input.dueDay } : {}),
        ...(input.paymentUrl !== undefined
          ? { paymentUrl: input.paymentUrl }
          : {}),
        ...(input.reference !== undefined
          ? { reference: input.reference }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.totalAmount !== undefined
          ? { totalAmount: new Prisma.Decimal(input.totalAmount) }
          : {}),
        ...(input.estimatedAmount !== undefined
          ? { estimatedAmount: new Prisma.Decimal(input.estimatedAmount) }
          : {}),
        ...(input.nextDueDate !== undefined
          ? { nextDueDate: new Date(`${input.nextDueDate}T00:00:00Z`) }
          : {}),
      },
      include: { occurrences: { orderBy: { dueDate: "asc" } } },
    });
    if (input.nextDueDate) {
      await this.prisma.paymentOccurrence.upsert({
        where: {
          paymentPlanId_dueDate: {
            paymentPlanId: id,
            dueDate: new Date(`${input.nextDueDate}T00:00:00Z`),
          },
        },
        create: {
          householdId: actor.householdId,
          paymentPlanId: id,
          dueDate: new Date(`${input.nextDueDate}T00:00:00Z`),
          plannedAmount:
            input.estimatedAmount !== undefined
              ? new Prisma.Decimal(input.estimatedAmount)
              : existing.estimatedAmount,
        },
        update: {
          ...(input.estimatedAmount !== undefined
            ? { plannedAmount: new Prisma.Decimal(input.estimatedAmount) }
            : {}),
        },
      });
    }
    return this.find(id, actor);
  }

  async archive(id: string, actor: Actor) {
    const existing = await this.find(id, actor);
    if (existing.ownerMemberId !== actor.memberId && actor.role !== "owner") {
      throw new NotFoundException();
    }
    return this.prisma.paymentPlan.update({
      where: { id },
      data: { status: "archived" },
    });
  }

  async addOccurrence(id: string, raw: unknown, actor: Actor) {
    const plan = await this.find(id, actor);
    const parsed = occurrenceInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      return await this.prisma.paymentOccurrence.create({
        data: {
          householdId: actor.householdId,
          paymentPlanId: id,
          dueDate: new Date(`${parsed.data.dueDate}T00:00:00Z`),
          plannedAmount: parsed.data.plannedAmount
            ? new Prisma.Decimal(parsed.data.plannedAmount)
            : plan.estimatedAmount,
          note: parsed.data.note ?? null,
        },
      });
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === "P2002"
      ) {
        throw new ConflictException("Ya existe un pago para esa fecha");
      }
      throw cause;
    }
  }

  async markPaid(occurrenceId: string, raw: unknown, actor: Actor) {
    const parsed = paidInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const occurrence = await this.prisma.paymentOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { paymentPlan: true },
    });
    if (
      !occurrence ||
      occurrence.householdId !== actor.householdId ||
      (occurrence.paymentPlan.visibility === "private" &&
        occurrence.paymentPlan.ownerMemberId !== actor.memberId)
    ) {
      throw new NotFoundException();
    }
    if (occurrence.status === "paid")
      throw new ConflictException("El pago ya fue marcado como realizado");
    if (parsed.data.sourcePocketId) {
      const pocket = await this.prisma.pocket.findUnique({
        where: { id: parsed.data.sourcePocketId },
      });
      if (
        !pocket ||
        pocket.householdId !== actor.householdId ||
        pocket.currency !== occurrence.paymentPlan.currency ||
        (pocket.visibility === "private" &&
          pocket.ownerMemberId !== actor.memberId)
      )
        throw new NotFoundException();
    }
    return this.prisma.paymentOccurrence.update({
      where: { id: occurrenceId },
      data: {
        status: "paid",
        paidAt: new Date(),
        actualAmount: new Prisma.Decimal(parsed.data.actualAmount),
        sourcePocketId: parsed.data.sourcePocketId ?? null,
        note: parsed.data.note ?? null,
      },
    });
  }

  private async find(id: string, actor: Actor) {
    const plan = await this.prisma.paymentPlan.findFirst({
      where: { id, ...this.visible(actor) },
      include: { occurrences: true },
    });
    if (!plan) throw new NotFoundException();
    return plan;
  }
}
