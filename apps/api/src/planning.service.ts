import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  generateRecurringIncomeDates,
  planningTimeBucket,
  previewExpectedIncomeFunding,
} from "@finanzas/domain";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { PrismaService } from "./prisma.service.js";

const Visibility = z.enum(["household", "private"]);
const Currency = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase());
const PositiveMoney = z
  .string()
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0);
const DateOnly = z.iso.date();

const IncomeSourceInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum([
    "salary",
    "bonus_midyear",
    "bonus_endyear",
    "rent",
    "investment_income",
    "freelance",
    "business",
    "pension",
    "windfall",
    "other",
  ]),
  visibility: Visibility.default("household"),
  currency: Currency,
  recurrence: z
    .enum([
      "once",
      "weekly",
      "biweekly",
      "monthly",
      "quarterly",
      "semiannual",
      "annual",
      "custom",
    ])
    .default("once"),
  defaultAmount: PositiveMoney.optional(),
  description: z.string().trim().max(500).optional(),
});

const IncomeSourcePatch = IncomeSourceInput.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Debes enviar al menos un cambio",
);

const ExpectedIncomeInput = z.object({
  sourceId: z.string().min(1),
  expectedDate: DateOnly,
  expectedAmount: PositiveMoney,
  probability: z.number().min(0).max(1).default(1),
  status: z.enum(["planned", "confirmed"]).default("planned"),
  reason: z.string().trim().min(1).max(300),
  notes: z.string().trim().max(1000).optional(),
  repeatUntil: DateOnly.optional(),
});

const ExpectedIncomePatch = ExpectedIncomeInput.omit({ repeatUntil: true })
  .partial()
  .extend({
    status: z
      .enum(["planned", "confirmed", "received", "cancelled"])
      .optional(),
    actualAmount: PositiveMoney.nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Debes enviar al menos un cambio",
  );

const AllocationInput = z
  .object({
    expectedIncomeId: z.string().min(1),
    pocketId: z.string().min(1).optional(),
    paymentPlanId: z.string().min(1).optional(),
    mode: z.enum(["fixed", "percentage", "remainder"]),
    value: z.string().optional(),
    priority: z.number().int().min(1),
    rationale: z.string().trim().min(1).max(500),
  })
  .superRefine((value, context) => {
    if (Boolean(value.pocketId) === Boolean(value.paymentPlanId)) {
      context.addIssue({
        code: "custom",
        path: ["pocketId"],
        message: "Selecciona exactamente un bolsillo o un pago",
      });
    }
    if (value.mode !== "remainder" && value.value === undefined) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "La regla requiere un valor",
      });
    }
  });

const PlanInput = z.object({
  title: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(1000),
  horizon: z.enum(["daily", "weekly", "monthly", "short_term", "long_term"]),
  visibility: Visibility.default("household"),
  currency: Currency,
  status: z.enum(["draft", "agreed", "active"]).default("draft"),
  startDate: DateOnly,
  targetDate: DateOnly.optional(),
  decisionNote: z.string().trim().min(1).max(1000),
  allocations: z.array(AllocationInput).min(1),
});

const PlanPatch = PlanInput.omit({ allocations: true })
  .partial()
  .extend({
    decisionNote: z.string().trim().min(1).max(1000),
    allocations: z.array(AllocationInput).min(1).optional(),
    status: z
      .enum(["draft", "agreed", "active", "completed", "archived"])
      .optional(),
  });

function jsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class PlanningService {
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

  async overview(actor: Actor, today: string) {
    if (!DateOnly.safeParse(today).success) {
      throw new BadRequestException("today debe usar YYYY-MM-DD");
    }
    const [sources, incomes, plans] = await Promise.all([
      this.prisma.incomeSource.findMany({
        where: { ...this.visible(actor), active: true },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.expectedIncome.findMany({
        where: {
          householdId: actor.householdId,
          source: {
            OR: [
              { visibility: "household" },
              { ownerMemberId: actor.memberId },
            ],
          },
        },
        include: { source: true, fundingAllocations: true },
        orderBy: { expectedDate: "asc" },
      }),
      this.prisma.financialPlan.findMany({
        where: { ...this.visible(actor), status: { not: "archived" } },
        include: {
          allocations: {
            include: {
              expectedIncome: { include: { source: true } },
              pocket: true,
              paymentPlan: true,
            },
            orderBy: { priority: "asc" },
          },
          revisions: { orderBy: { version: "desc" }, take: 1 },
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    return {
      sources,
      incomes: incomes.map((income) => ({
        ...income,
        timeBucket: planningTimeBucket(
          income.expectedDate.toISOString().slice(0, 10),
          today,
        ),
      })),
      plans: plans.map((plan) => ({
        ...plan,
        forecasts: this.forecastsForPlan(plan),
      })),
    };
  }

  createSource(raw: unknown, actor: Actor) {
    const parsed = IncomeSourceInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    return this.prisma.incomeSource.create({
      data: {
        householdId: actor.householdId,
        ownerMemberId: actor.memberId,
        visibility: input.visibility,
        name: input.name,
        kind: input.kind,
        currency: input.currency,
        recurrence: input.recurrence,
        defaultAmount: input.defaultAmount
          ? new Prisma.Decimal(input.defaultAmount)
          : null,
        description: input.description ?? null,
      },
    });
  }

  async updateSource(id: string, raw: unknown, actor: Actor) {
    const parsed = IncomeSourcePatch.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const existing = await this.prisma.incomeSource.findUnique({
      where: { id },
      include: { _count: { select: { expectedIncomes: true } } },
    });
    if (!existing || !this.canRead(existing, actor))
      throw new NotFoundException();
    if (existing.ownerMemberId !== actor.memberId && actor.role !== "owner") {
      throw new NotFoundException();
    }
    if (
      parsed.data.currency &&
      parsed.data.currency !== existing.currency &&
      existing._count.expectedIncomes > 0
    ) {
      throw new ConflictException(
        "No puedes cambiar la moneda de una fuente que ya tiene ingresos esperados",
      );
    }
    const updated = await this.prisma.incomeSource.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
        ...(parsed.data.visibility !== undefined
          ? { visibility: parsed.data.visibility }
          : {}),
        ...(parsed.data.currency !== undefined
          ? { currency: parsed.data.currency }
          : {}),
        ...(parsed.data.recurrence !== undefined
          ? { recurrence: parsed.data.recurrence }
          : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
        ...(parsed.data.defaultAmount !== undefined
          ? {
              defaultAmount: parsed.data.defaultAmount
                ? new Prisma.Decimal(parsed.data.defaultAmount)
                : null,
            }
          : {}),
      },
    });
    await this.recordAudit(
      actor,
      "IncomeSource",
      id,
      "updated",
      existing,
      updated,
    );
    return updated;
  }

  async archiveSource(id: string, actor: Actor) {
    const existing = await this.prisma.incomeSource.findUnique({
      where: { id },
    });
    if (!existing || !this.canRead(existing, actor))
      throw new NotFoundException();
    if (existing.ownerMemberId !== actor.memberId && actor.role !== "owner") {
      throw new NotFoundException();
    }
    const updated = await this.prisma.incomeSource.update({
      where: { id },
      data: { active: false },
    });
    await this.recordAudit(
      actor,
      "IncomeSource",
      id,
      "archived",
      existing,
      updated,
    );
    return updated;
  }

  async createExpectedIncome(raw: unknown, actor: Actor) {
    const parsed = ExpectedIncomeInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    const source = await this.prisma.incomeSource.findUnique({
      where: { id: input.sourceId },
    });
    if (!source || !this.canRead(source, actor)) throw new NotFoundException();
    let dates: string[];
    try {
      dates = generateRecurringIncomeDates({
        startDate: input.expectedDate,
        ...(input.repeatUntil ? { endDate: input.repeatUntil } : {}),
        recurrence: source.recurrence,
      });
    } catch (cause) {
      throw new BadRequestException(
        cause instanceof Error ? cause.message : "Recurrencia inválida",
      );
    }
    const created = await this.prisma.$transaction(
      dates.map((expectedDate) =>
        this.prisma.expectedIncome.upsert({
          where: {
            sourceId_expectedDate: {
              sourceId: source.id,
              expectedDate: new Date(`${expectedDate}T00:00:00Z`),
            },
          },
          update: {},
          create: {
            householdId: actor.householdId,
            sourceId: source.id,
            expectedDate: new Date(`${expectedDate}T00:00:00Z`),
            expectedAmount: new Prisma.Decimal(input.expectedAmount),
            currency: source.currency,
            probability: new Prisma.Decimal(input.probability),
            status: input.status,
            reason: input.reason,
            notes: input.notes ?? null,
          },
          include: { source: true },
        }),
      ),
    );
    const first = created[0];
    if (!first) throw new BadRequestException("No se generaron ocurrencias");
    return { ...first, seriesCreated: created.length };
  }

  async updateExpectedIncome(id: string, raw: unknown, actor: Actor) {
    const parsed = ExpectedIncomePatch.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const existing = await this.expectedIncomeForActor(id, actor);
    await this.ensureIncomeCanChange(id);
    const sourceId = parsed.data.sourceId ?? existing.sourceId;
    const source = await this.prisma.incomeSource.findUnique({
      where: { id: sourceId },
    });
    if (!source || !this.canRead(source, actor)) throw new NotFoundException();
    if (
      source.currency !== existing.currency &&
      sourceId !== existing.sourceId
    ) {
      throw new BadRequestException(
        "La fuente nueva debe usar la misma moneda del ingreso",
      );
    }
    try {
      const updated = await this.prisma.expectedIncome.update({
        where: { id },
        data: {
          ...(parsed.data.sourceId !== undefined
            ? { sourceId: parsed.data.sourceId }
            : {}),
          ...(parsed.data.expectedDate !== undefined
            ? {
                expectedDate: new Date(`${parsed.data.expectedDate}T00:00:00Z`),
              }
            : {}),
          ...(parsed.data.expectedAmount !== undefined
            ? { expectedAmount: new Prisma.Decimal(parsed.data.expectedAmount) }
            : {}),
          ...(parsed.data.actualAmount !== undefined
            ? {
                actualAmount: parsed.data.actualAmount
                  ? new Prisma.Decimal(parsed.data.actualAmount)
                  : null,
              }
            : {}),
          ...(parsed.data.probability !== undefined
            ? { probability: new Prisma.Decimal(parsed.data.probability) }
            : {}),
          ...(parsed.data.status !== undefined
            ? {
                status: parsed.data.status,
                receivedAt:
                  parsed.data.status === "received" ? new Date() : null,
              }
            : {}),
          ...(parsed.data.reason !== undefined
            ? { reason: parsed.data.reason }
            : {}),
          ...(parsed.data.notes !== undefined
            ? { notes: parsed.data.notes ?? null }
            : {}),
        },
        include: { source: true },
      });
      await this.recordAudit(
        actor,
        "ExpectedIncome",
        id,
        "updated",
        existing,
        updated,
      );
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "Ya existe un ingreso de esa fuente para la fecha seleccionada",
        );
      }
      throw error;
    }
  }

  async cancelExpectedIncome(id: string, actor: Actor) {
    const existing = await this.expectedIncomeForActor(id, actor);
    await this.ensureIncomeCanChange(id);
    if (existing.status === "received") {
      throw new ConflictException(
        "Un ingreso recibido debe conciliarse; no puede cancelarse",
      );
    }
    const updated = await this.prisma.expectedIncome.update({
      where: { id },
      data: { status: "cancelled" },
      include: { source: true },
    });
    await this.recordAudit(
      actor,
      "ExpectedIncome",
      id,
      "cancelled",
      existing,
      updated,
    );
    return updated;
  }

  async createPlan(raw: unknown, actor: Actor) {
    const parsed = PlanInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    if (input.targetDate && input.targetDate < input.startDate) {
      throw new BadRequestException(
        "La fecha objetivo no puede ser anterior al inicio",
      );
    }
    await this.validateAllocations(
      input.visibility,
      input.currency,
      input.allocations,
      actor,
    );
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.financialPlan.create({
        data: {
          householdId: actor.householdId,
          ownerMemberId: actor.memberId,
          visibility: input.visibility,
          title: input.title,
          purpose: input.purpose,
          horizon: input.horizon,
          currency: input.currency,
          status: input.status,
          startDate: new Date(`${input.startDate}T00:00:00Z`),
          targetDate: input.targetDate
            ? new Date(`${input.targetDate}T00:00:00Z`)
            : null,
          allocations: {
            create: input.allocations.map((allocation) => ({
              householdId: actor.householdId,
              expectedIncomeId: allocation.expectedIncomeId,
              pocketId: allocation.pocketId ?? null,
              paymentPlanId: allocation.paymentPlanId ?? null,
              mode: allocation.mode,
              value: allocation.value
                ? new Prisma.Decimal(allocation.value)
                : null,
              priority: allocation.priority,
              rationale: allocation.rationale,
            })),
          },
        },
        include: { allocations: true },
      });
      await tx.planRevision.create({
        data: {
          householdId: actor.householdId,
          planId: plan.id,
          version: 1,
          snapshot: jsonSnapshot(plan),
          decisionNote: input.decisionNote,
          createdByMemberId: actor.memberId,
        },
      });
      await tx.planAuditEvent.create({
        data: {
          householdId: actor.householdId,
          planId: plan.id,
          actorMemberId: actor.memberId,
          action: "created",
          details: { decisionNote: input.decisionNote },
        },
      });
      return plan;
    });
  }

  async revisePlan(id: string, raw: unknown, actor: Actor) {
    const parsed = PlanPatch.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    const existing = await this.planForActor(id, actor);
    const resolvedStart =
      input.startDate ?? existing.startDate.toISOString().slice(0, 10);
    const resolvedTarget =
      input.targetDate ?? existing.targetDate?.toISOString().slice(0, 10);
    if (resolvedTarget && resolvedTarget < resolvedStart) {
      throw new BadRequestException(
        "La fecha objetivo no puede ser anterior al inicio",
      );
    }
    if (
      !input.allocations &&
      ((input.visibility !== undefined &&
        input.visibility !== existing.visibility) ||
        (input.currency !== undefined && input.currency !== existing.currency))
    ) {
      throw new BadRequestException(
        "Cambiar alcance o moneda requiere volver a declarar las asignaciones",
      );
    }
    const visibility = input.visibility ?? existing.visibility;
    const currency = input.currency ?? existing.currency;
    if (input.allocations) {
      const executed = await this.prisma.planFundingAllocation.findFirst({
        where: { planId: id, status: { not: "planned" } },
        select: { id: true },
      });
      if (executed) {
        throw new ConflictException(
          "Los destinos con ejecución parcial o total no pueden reemplazarse; crea un nuevo plan para el remanente",
        );
      }
      await this.validateAllocations(
        visibility,
        currency,
        input.allocations,
        actor,
        id,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      if (input.allocations) {
        await tx.planFundingAllocation.deleteMany({ where: { planId: id } });
        await tx.planFundingAllocation.createMany({
          data: input.allocations.map((allocation) => ({
            householdId: actor.householdId,
            planId: id,
            expectedIncomeId: allocation.expectedIncomeId,
            pocketId: allocation.pocketId ?? null,
            paymentPlanId: allocation.paymentPlanId ?? null,
            mode: allocation.mode,
            value: allocation.value
              ? new Prisma.Decimal(allocation.value)
              : null,
            priority: allocation.priority,
            rationale: allocation.rationale,
          })),
        });
      }
      const updated = await tx.financialPlan.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.horizon !== undefined ? { horizon: input.horizon } : {}),
          ...(input.visibility !== undefined
            ? { visibility: input.visibility }
            : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.startDate !== undefined
            ? { startDate: new Date(`${input.startDate}T00:00:00Z`) }
            : {}),
          ...(input.targetDate !== undefined
            ? { targetDate: new Date(`${input.targetDate}T00:00:00Z`) }
            : {}),
          version: { increment: 1 },
        },
        include: { allocations: true },
      });
      await tx.planRevision.create({
        data: {
          householdId: actor.householdId,
          planId: id,
          version: updated.version,
          snapshot: jsonSnapshot(updated),
          decisionNote: input.decisionNote,
          createdByMemberId: actor.memberId,
        },
      });
      await tx.planAuditEvent.create({
        data: {
          householdId: actor.householdId,
          planId: id,
          actorMemberId: actor.memberId,
          action: "revised",
          details: {
            version: updated.version,
            decisionNote: input.decisionNote,
          },
        },
      });
      return updated;
    });
  }

  async history(id: string, actor: Actor) {
    await this.planForActor(id, actor);
    return this.prisma.planRevision.findMany({
      where: { planId: id, householdId: actor.householdId },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: { version: "desc" },
    });
  }

  async archivePlan(id: string, actor: Actor) {
    const existing = await this.planForActor(id, actor);
    if (existing.ownerMemberId !== actor.memberId && actor.role !== "owner") {
      throw new NotFoundException();
    }
    const updated = await this.prisma.financialPlan.update({
      where: { id },
      data: { status: "archived" },
    });
    await this.recordAudit(
      actor,
      "FinancialPlan",
      id,
      "archived",
      existing,
      updated,
    );
    return updated;
  }

  async executeAllocation(id: string, raw: unknown, key: string, actor: Actor) {
    if (!key) throw new BadRequestException("Idempotency-Key es obligatorio");
    const parsed = z.object({ amount: PositiveMoney }).safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const allocation = await this.prisma.planFundingAllocation.findUnique({
      where: { id },
      include: {
        plan: true,
        expectedIncome: true,
        pocket: true,
        paymentPlan: true,
      },
    });
    if (!allocation || !this.canRead(allocation.plan, actor)) {
      throw new NotFoundException();
    }
    if (allocation.expectedIncome.status !== "received") {
      throw new ConflictException(
        "Confirma primero que el ingreso fue recibido",
      );
    }
    const siblings = await this.prisma.planFundingAllocation.findMany({
      where: {
        planId: allocation.planId,
        expectedIncomeId: allocation.expectedIncomeId,
      },
      orderBy: { priority: "asc" },
    });
    const base =
      allocation.expectedIncome.actualAmount ??
      allocation.expectedIncome.expectedAmount;
    const forecast = previewExpectedIncomeFunding({
      incomeAmount: base.toString(),
      currency: allocation.plan.currency,
      allocations: siblings.map((item) => ({
        targetId: item.id,
        mode: item.mode as "fixed" | "percentage" | "remainder",
        ...(item.value !== null ? { value: item.value.toString() } : {}),
        priority: item.priority,
      })),
    });
    const planned = new Prisma.Decimal(
      forecast.allocations.find((item) => item.targetId === id)?.amount ?? 0,
    );
    const requested = new Prisma.Decimal(parsed.data.amount);
    const remaining = planned.minus(allocation.executedAmount);
    if (requested.greaterThan(remaining)) {
      throw new BadRequestException(
        `Solo quedan ${remaining.toString()} por ejecutar en este destino`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const repeated = await tx.planAuditEvent.findFirst({
        where: {
          planId: allocation.planId,
          action: "allocation_executed",
          details: { path: ["idempotencyKey"], equals: key },
        },
      });
      if (repeated) return allocation;
      let pocketEventId: string | null = null;
      if (allocation.pocket) {
        const event = await tx.pocketEvent.create({
          data: {
            householdId: actor.householdId,
            pocketId: allocation.pocket.id,
            actorMemberId: actor.memberId,
            type: "allocated",
            amount: requested,
            currency: allocation.plan.currency,
            planningOnly: true,
            idempotencyKey: key,
            metadata: {
              planId: allocation.planId,
              allocationId: id,
              expectedIncomeId: allocation.expectedIncomeId,
            },
          },
        });
        pocketEventId = event.id;
        await tx.pocket.update({
          where: { id: allocation.pocket.id },
          data: {
            currentAmount: { increment: requested },
            version: { increment: 1 },
          },
        });
      }
      const nextExecuted = allocation.executedAmount.plus(requested);
      const status = nextExecuted.greaterThanOrEqualTo(planned)
        ? "applied"
        : "partial";
      const updated = await tx.planFundingAllocation.update({
        where: { id },
        data: {
          executedAmount: nextExecuted,
          status,
          appliedAt: status === "applied" ? new Date() : null,
          pocketEventId,
        },
      });
      await tx.planAuditEvent.create({
        data: {
          householdId: actor.householdId,
          planId: allocation.planId,
          actorMemberId: actor.memberId,
          action: "allocation_executed",
          details: {
            idempotencyKey: key,
            allocationId: id,
            amount: requested.toString(),
            status,
          },
        },
      });
      return updated;
    });
  }

  private async planForActor(id: string, actor: Actor) {
    const plan = await this.prisma.financialPlan.findUnique({ where: { id } });
    if (!plan || !this.canRead(plan, actor)) throw new NotFoundException();
    return plan;
  }

  private async expectedIncomeForActor(id: string, actor: Actor) {
    const income = await this.prisma.expectedIncome.findUnique({
      where: { id },
      include: { source: true },
    });
    if (!income || !this.canRead(income.source, actor)) {
      throw new NotFoundException();
    }
    return income;
  }

  private async ensureIncomeCanChange(id: string) {
    const applied = await this.prisma.planFundingAllocation.findFirst({
      where: { expectedIncomeId: id, status: { not: "planned" } },
      select: { id: true },
    });
    if (applied) {
      throw new ConflictException(
        "El ingreso ya tiene asignaciones aplicadas y no puede modificarse",
      );
    }
  }

  private recordAudit(
    actor: Actor,
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
  ) {
    return this.prisma.auditLog.create({
      data: {
        householdId: actor.householdId,
        actorMemberId: actor.memberId,
        entityType,
        entityId,
        action,
        before: jsonSnapshot(before),
        after: jsonSnapshot(after),
      },
    });
  }

  private canRead(
    entity: {
      householdId: string;
      visibility: "household" | "private";
      ownerMemberId: string;
    },
    actor: Actor,
  ) {
    return (
      entity.householdId === actor.householdId &&
      (entity.visibility === "household" ||
        entity.ownerMemberId === actor.memberId)
    );
  }

  private async validateAllocations(
    visibility: "household" | "private",
    currency: string,
    allocations: z.infer<typeof AllocationInput>[],
    actor: Actor,
    excludePlanId?: string,
  ) {
    const incomeIds = [
      ...new Set(allocations.map((item) => item.expectedIncomeId)),
    ];
    const pocketIds = [
      ...new Set(
        allocations.flatMap((item) => (item.pocketId ? [item.pocketId] : [])),
      ),
    ];
    const paymentIds = [
      ...new Set(
        allocations.flatMap((item) =>
          item.paymentPlanId ? [item.paymentPlanId] : [],
        ),
      ),
    ];
    const [incomes, pockets, payments, existingAllocation] = await Promise.all([
      this.prisma.expectedIncome.findMany({
        where: { id: { in: incomeIds }, householdId: actor.householdId },
        include: { source: true },
      }),
      this.prisma.pocket.findMany({
        where: { id: { in: pocketIds }, householdId: actor.householdId },
      }),
      this.prisma.paymentPlan.findMany({
        where: { id: { in: paymentIds }, householdId: actor.householdId },
      }),
      this.prisma.planFundingAllocation.findFirst({
        where: {
          expectedIncomeId: { in: incomeIds },
          status: "planned",
          ...(excludePlanId ? { planId: { not: excludePlanId } } : {}),
        },
      }),
    ]);
    if (existingAllocation) {
      throw new ConflictException(
        "Este ingreso ya tiene un plan; revisa ese acuerdo en lugar de duplicarlo",
      );
    }
    if (
      incomes.length !== incomeIds.length ||
      pockets.length !== pocketIds.length ||
      payments.length !== paymentIds.length
    ) {
      throw new NotFoundException();
    }
    if (
      incomes.some(
        (income) =>
          !this.canRead(income.source, actor) ||
          income.source.visibility !== visibility ||
          income.currency !== currency,
      ) ||
      pockets.some(
        (pocket) =>
          !this.canRead(pocket, actor) ||
          pocket.visibility !== visibility ||
          pocket.currency !== currency,
      ) ||
      payments.some(
        (payment) =>
          !this.canRead(payment, actor) ||
          payment.visibility !== visibility ||
          payment.currency !== currency,
      )
    ) {
      throw new BadRequestException(
        "Fuente, bolsillo, visibilidad y moneda deben pertenecer al mismo alcance",
      );
    }
    for (const income of incomes) {
      try {
        const forecast = previewExpectedIncomeFunding({
          incomeAmount: income.expectedAmount.toString(),
          currency,
          allocations: allocations
            .filter((item) => item.expectedIncomeId === income.id)
            .map((item) => ({
              targetId: item.pocketId ?? item.paymentPlanId ?? "",
              mode: item.mode,
              ...(item.value !== undefined ? { value: item.value } : {}),
              priority: item.priority,
            })),
        });
        if (Number(forecast.overallocatedAmount) > 0) {
          throw new Error(`Las asignaciones superan el ingreso ${income.id}`);
        }
      } catch (cause) {
        throw new BadRequestException(
          cause instanceof Error ? cause.message : "Asignaciones inválidas",
        );
      }
    }
  }

  private forecastsForPlan(plan: {
    currency: string;
    allocations: Array<{
      expectedIncomeId: string;
      pocketId: string | null;
      paymentPlanId: string | null;
      mode: string;
      value: Prisma.Decimal | null;
      priority: number;
      expectedIncome: { expectedAmount: Prisma.Decimal };
    }>;
  }) {
    const incomeIds = [
      ...new Set(plan.allocations.map((item) => item.expectedIncomeId)),
    ];
    return incomeIds.map((incomeId) => {
      const allocations = plan.allocations.filter(
        (item) => item.expectedIncomeId === incomeId,
      );
      const first = allocations[0];
      if (!first) return null;
      return {
        expectedIncomeId: incomeId,
        ...previewExpectedIncomeFunding({
          incomeAmount: first.expectedIncome.expectedAmount.toString(),
          currency: plan.currency,
          allocations: allocations.map((item) => ({
            targetId: item.pocketId ?? item.paymentPlanId ?? "",
            mode: item.mode as "fixed" | "percentage" | "remainder",
            ...(item.value !== null ? { value: item.value.toString() } : {}),
            priority: item.priority,
          })),
        }),
      };
    });
  }
}
