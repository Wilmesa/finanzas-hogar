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

const AllocationInput = z
  .object({
    expectedIncomeId: z.string().min(1),
    pocketId: z.string().min(1),
    mode: z.enum(["fixed", "percentage", "remainder"]),
    value: z.string().optional(),
    priority: z.number().int().min(1),
    rationale: z.string().trim().min(1).max(500),
  })
  .superRefine((value, context) => {
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
              pocketId: allocation.pocketId,
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
            pocketId: allocation.pocketId,
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

  private async planForActor(id: string, actor: Actor) {
    const plan = await this.prisma.financialPlan.findUnique({ where: { id } });
    if (!plan || !this.canRead(plan, actor)) throw new NotFoundException();
    return plan;
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
    const pocketIds = [...new Set(allocations.map((item) => item.pocketId))];
    const [incomes, pockets, existingAllocation] = await Promise.all([
      this.prisma.expectedIncome.findMany({
        where: { id: { in: incomeIds }, householdId: actor.householdId },
        include: { source: true },
      }),
      this.prisma.pocket.findMany({
        where: { id: { in: pocketIds }, householdId: actor.householdId },
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
      pockets.length !== pocketIds.length
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
              targetId: item.pocketId,
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
      pocketId: string;
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
            targetId: item.pocketId,
            mode: item.mode as "fixed" | "percentage" | "remainder",
            ...(item.value !== null ? { value: item.value.toString() } : {}),
            priority: item.priority,
          })),
        }),
      };
    });
  }
}
