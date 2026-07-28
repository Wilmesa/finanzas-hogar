import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  amortizeDebt,
  projectCdt,
  projectGoalByContribution,
  projectGoalByDate,
  projectInvestment,
  projectRealEstate,
} from "@finanzas/domain";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { PocketsService } from "./pockets.service.js";
import { PrismaService } from "./prisma.service.js";

const saveSchema = z.object({
  kind: z.enum(["savings", "debt", "cdt", "investment", "real_estate"]),
  name: z.string().trim().min(1).max(140),
  visibility: z.enum(["household", "private"]).default("household"),
  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase()),
  assumptions: z.record(z.string(), z.unknown()),
});

@Injectable()
export class SimulationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pockets: PocketsService,
  ) {}

  list(actor: Actor) {
    return this.prisma.financialSimulation.findMany({
      where: {
        householdId: actor.householdId,
        status: { not: "archived" },
        OR: [{ visibility: "household" }, { ownerMemberId: actor.memberId }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async save(raw: unknown, actor: Actor) {
    const parsed = saveSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const input = parsed.data;
    let result: unknown;
    try {
      result = this.calculate(input.kind, {
        ...input.assumptions,
        currency: input.currency,
      });
    } catch (cause) {
      throw new BadRequestException(
        cause instanceof Error ? cause.message : "Supuestos inválidos",
      );
    }
    return this.prisma.financialSimulation.create({
      data: {
        householdId: actor.householdId,
        ownerMemberId: actor.memberId,
        visibility: input.visibility,
        kind: input.kind,
        name: input.name,
        currency: input.currency,
        assumptions: input.assumptions as Prisma.InputJsonValue,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
      },
    });
  }

  async convert(id: string, raw: unknown, actor: Actor) {
    const parsed = z
      .object({
        target: z.enum(["pocket", "scheduled_payment"]),
        name: z.string().trim().min(1).max(140).optional(),
        startDate: z.iso.date(),
        recurrence: z
          .enum([
            "once",
            "weekly",
            "biweekly",
            "monthly",
            "quarterly",
            "annual",
          ])
          .default("monthly"),
        visibility: z.enum(["household", "private"]).optional(),
      })
      .safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const simulation = await this.find(id, actor);
    if (simulation.status === "converted") {
      return {
        simulation,
        convertedEntityType: simulation.convertedEntityType,
        convertedEntityId: simulation.convertedEntityId,
        replayed: true,
      };
    }
    const assumptions = simulation.assumptions as Record<string, unknown>;
    if (parsed.data.target === "pocket") {
      const targetAmount = String(
        assumptions.targetAmount ??
          assumptions.downPayment ??
          assumptions.principal ??
          "0",
      );
      if (!(Number(targetAmount) > 0)) {
        throw new BadRequestException(
          "La simulación no contiene una meta monetaria convertible",
        );
      }
      const targetDate =
        typeof assumptions.targetDate === "string"
          ? assumptions.targetDate
          : undefined;
      const contribution =
        assumptions.contributionAmount ?? assumptions.monthlySavings;
      const policy = targetDate
        ? {
            kind: "target_by_date" as const,
            targetAmount,
            targetDate,
            frequency: "monthly" as const,
          }
        : contribution
          ? {
              kind: "target_by_contribution" as const,
              targetAmount,
              contributionAmount: String(contribution),
              frequency: "monthly" as const,
            }
          : {
              kind: "target_by_contribution" as const,
              targetAmount,
              contributionAmount: targetAmount,
              frequency: "monthly" as const,
            };
      const pocket = await this.pockets.create(
        {
          name: parsed.data.name ?? simulation.name,
          purpose: "custom",
          visibility: parsed.data.visibility ?? simulation.visibility,
          currency: simulation.currency,
          currentAmount: String(assumptions.currentAmount ?? "0"),
          policy,
          rolloverPolicy: "carry_balance",
          notes: `Creado desde la simulación ${simulation.id}. Los valores continúan siendo una meta hasta registrar movimientos reales.`,
        },
        actor,
      );
      const updated = await this.markConverted(
        simulation.id,
        "Pocket",
        pocket.id,
      );
      return { simulation: updated, pocket };
    }

    if (simulation.kind !== "debt") {
      throw new BadRequestException(
        "Solo una simulación de deuda puede convertirse directamente en pago programado",
      );
    }
    const result = simulation.result as {
      schedule?: Array<{ payment?: string }>;
      months?: number;
    };
    const plannedAmount = String(
      result.schedule?.[0]?.payment ?? assumptions.monthlyPayment ?? "0",
    );
    if (!(Number(plannedAmount) > 0)) {
      throw new BadRequestException(
        "La simulación no contiene una cuota válida",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentPlan.create({
        data: {
          householdId: actor.householdId,
          ownerMemberId: actor.memberId,
          visibility: parsed.data.visibility ?? simulation.visibility,
          name: parsed.data.name ?? simulation.name,
          type: "debt",
          currency: simulation.currency,
          recurrence: parsed.data.recurrence,
          estimatedAmount: new Prisma.Decimal(plannedAmount),
          nextDueDate: new Date(`${parsed.data.startDate}T00:00:00Z`),
          notes: `Generado desde simulación ${simulation.id}`,
          occurrences: {
            create: {
              householdId: actor.householdId,
              dueDate: new Date(`${parsed.data.startDate}T00:00:00Z`),
              plannedAmount: new Prisma.Decimal(plannedAmount),
            },
          },
        },
        include: { occurrences: true },
      });
      const schedule = result.schedule ?? [];
      const payoffDate = new Date(`${parsed.data.startDate}T00:00:00Z`);
      payoffDate.setUTCMonth(
        payoffDate.getUTCMonth() + Number(result.months ?? schedule.length),
      );
      const debt = await tx.debtAccount.create({
        data: {
          householdId: actor.householdId,
          ownerMemberId: actor.memberId,
          visibility: parsed.data.visibility ?? simulation.visibility,
          name: parsed.data.name ?? simulation.name,
          currency: simulation.currency,
          principal: new Prisma.Decimal(String(assumptions.principal)),
          annualRate: new Prisma.Decimal(String(assumptions.annualRate)),
          minimumPayment: new Prisma.Decimal(
            String(assumptions.monthlyPayment),
          ),
          extraPayment: new Prisma.Decimal(
            String(assumptions.extraPayment ?? 0),
          ),
          strategy:
            Number(assumptions.extraPayment ?? 0) > 0
              ? "avalanche"
              : "contractual",
          paymentPlanId: payment.id,
          projectedSchedule: schedule as Prisma.InputJsonValue,
          projectedPayoffDate: payoffDate,
        },
      });
      const updated = await tx.financialSimulation.update({
        where: { id: simulation.id },
        data: {
          status: "converted",
          convertedAt: new Date(),
          convertedEntityType: "PaymentPlan",
          convertedEntityId: payment.id,
        },
      });
      return { simulation: updated, payment, debt };
    });
  }

  async archive(id: string, actor: Actor) {
    const simulation = await this.find(id, actor);
    if (simulation.ownerMemberId !== actor.memberId && actor.role !== "owner") {
      throw new NotFoundException();
    }
    return this.prisma.financialSimulation.update({
      where: { id },
      data: { status: "archived", archivedAt: new Date() },
    });
  }

  private calculate(
    kind: z.infer<typeof saveSchema>["kind"],
    input: Record<string, unknown>,
  ) {
    if (kind === "savings") {
      return input.targetDate
        ? projectGoalByDate(
            input as unknown as Parameters<typeof projectGoalByDate>[0],
          )
        : projectGoalByContribution(
            input as unknown as Parameters<typeof projectGoalByContribution>[0],
          );
    }
    if (kind === "debt")
      return amortizeDebt(
        input as unknown as Parameters<typeof amortizeDebt>[0],
      );
    if (kind === "cdt")
      return projectCdt(input as unknown as Parameters<typeof projectCdt>[0]);
    if (kind === "investment")
      return projectInvestment(
        input as unknown as Parameters<typeof projectInvestment>[0],
      );
    return projectRealEstate(
      input as unknown as Parameters<typeof projectRealEstate>[0],
    );
  }

  private async find(id: string, actor: Actor) {
    const simulation = await this.prisma.financialSimulation.findFirst({
      where: {
        id,
        householdId: actor.householdId,
        OR: [{ visibility: "household" }, { ownerMemberId: actor.memberId }],
      },
    });
    if (!simulation) throw new NotFoundException();
    return simulation;
  }

  private async markConverted(
    id: string,
    convertedEntityType: string,
    convertedEntityId: string,
  ) {
    const result = await this.prisma.financialSimulation.updateMany({
      where: { id, status: "draft" },
      data: {
        status: "converted",
        convertedAt: new Date(),
        convertedEntityType,
        convertedEntityId,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException("La simulación ya fue convertida");
    }
    return this.prisma.financialSimulation.findUniqueOrThrow({ where: { id } });
  }
}
