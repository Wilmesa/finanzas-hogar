import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { PrismaService } from "./prisma.service.js";

const conditionsSchema = z.object({
  merchantPattern: z.string().min(1).max(200).optional(),
  currency: z.string().length(3).optional(),
  minimumAmount: z.string().optional(),
  maximumAmount: z.string().optional(),
  transactionType: z.enum(["withdrawal", "deposit", "transfer"]).optional(),
});
const actionsSchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  pocketId: z.string().uuid().optional(),
  reviewStatus: z
    .enum(["PENDING", "REVIEWED", "FLAGGED_FOR_PARTNER"])
    .optional(),
});
const ruleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  conditions: conditionsSchema,
  actions: actionsSchema,
  priority: z.number().int().min(1).max(10_000).default(100),
  enabled: z.boolean().default(true),
});

export type RuleTransactionInput = {
  merchant: string;
  amount: string;
  currency: string;
  type: "withdrawal" | "deposit" | "transfer";
};

@Injectable()
export class TransactionRulesService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: Actor) {
    return this.prisma.transactionRule.findMany({
      where: { householdId: actor.householdId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
  }

  async create(raw: unknown, actor: Actor) {
    const parsed = ruleSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.validateActions(parsed.data.actions, actor);
    return this.prisma.transactionRule.create({
      data: {
        householdId: actor.householdId,
        createdByMemberId: actor.memberId,
        name: parsed.data.name,
        conditions: parsed.data.conditions,
        actions: parsed.data.actions,
        priority: parsed.data.priority,
        enabled: parsed.data.enabled,
      },
    });
  }

  async update(id: string, raw: unknown, actor: Actor) {
    const parsed = ruleSchema.partial().safeParse(raw);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw new BadRequestException(
        parsed.success
          ? "Debes enviar al menos un cambio"
          : parsed.error.flatten(),
      );
    }
    const existing = await this.find(id, actor);
    if (parsed.data.actions) {
      await this.validateActions(parsed.data.actions, actor);
    }
    return this.prisma.transactionRule.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.priority !== undefined
          ? { priority: parsed.data.priority }
          : {}),
        ...(parsed.data.enabled !== undefined
          ? { enabled: parsed.data.enabled }
          : {}),
        ...(parsed.data.conditions
          ? { conditions: parsed.data.conditions as Prisma.InputJsonValue }
          : {}),
        ...(parsed.data.actions
          ? { actions: parsed.data.actions as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async archive(id: string, actor: Actor) {
    const existing = await this.find(id, actor);
    return this.prisma.transactionRule.update({
      where: { id: existing.id },
      data: { enabled: false },
    });
  }

  async suggest(input: RuleTransactionInput, actor: Actor) {
    const rules = await this.prisma.transactionRule.findMany({
      where: { householdId: actor.householdId, enabled: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    for (const rule of rules) {
      const conditions = conditionsSchema.safeParse(rule.conditions);
      const actions = actionsSchema.safeParse(rule.actions);
      if (!conditions.success || !actions.success) continue;
      if (!this.matches(conditions.data, input)) continue;
      await this.validateActions(actions.data, actor);
      return { ruleId: rule.id, ruleName: rule.name, ...actions.data };
    }
    return null;
  }

  private matches(
    conditions: z.infer<typeof conditionsSchema>,
    input: RuleTransactionInput,
  ) {
    if (
      conditions.currency &&
      conditions.currency.toUpperCase() !== input.currency.toUpperCase()
    )
      return false;
    if (conditions.transactionType && conditions.transactionType !== input.type)
      return false;
    if (
      conditions.minimumAmount &&
      Number(input.amount) < Number(conditions.minimumAmount)
    )
      return false;
    if (
      conditions.maximumAmount &&
      Number(input.amount) > Number(conditions.maximumAmount)
    )
      return false;
    if (conditions.merchantPattern) {
      try {
        if (!new RegExp(conditions.merchantPattern, "iu").test(input.merchant))
          return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  private async validateActions(
    actions: z.infer<typeof actionsSchema>,
    actor: Actor,
  ) {
    if (!actions.pocketId) return;
    const pocket = await this.prisma.pocket.findFirst({
      where: {
        id: actions.pocketId,
        householdId: actor.householdId,
        OR: [{ visibility: "household" }, { ownerMemberId: actor.memberId }],
      },
    });
    if (!pocket) throw new NotFoundException();
  }

  private async find(id: string, actor: Actor) {
    const rule = await this.prisma.transactionRule.findFirst({
      where: { id, householdId: actor.householdId },
    });
    if (!rule) throw new NotFoundException();
    return rule;
  }
}
