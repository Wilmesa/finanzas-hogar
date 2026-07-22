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

const CategoryInput = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(40).default("tag"),
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i)
    .default("#123C69"),
});

const CategoryPatch = CategoryInput.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Debes enviar al menos un cambio",
);

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: Actor) {
    return this.prisma.category.findMany({
      where: { householdId: actor.householdId, active: true },
      orderBy: { name: "asc" },
    });
  }

  async create(raw: unknown, actor: Actor) {
    const parsed = CategoryInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const category = await this.prisma.category.create({
        data: { householdId: actor.householdId, ...parsed.data },
      });
      await this.audit(actor, category.id, "created", null, category);
      return category;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  async update(id: string, raw: unknown, actor: Actor) {
    const parsed = CategoryPatch.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const existing = await this.find(id, actor);
    try {
      const category = await this.prisma.category.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon } : {}),
          ...(parsed.data.color !== undefined
            ? { color: parsed.data.color }
            : {}),
        },
      });
      await this.audit(actor, id, "updated", existing, category);
      return category;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  async archive(id: string, actor: Actor) {
    const existing = await this.find(id, actor);
    const category = await this.prisma.category.update({
      where: { id },
      data: { active: false },
    });
    await this.audit(actor, id, "archived", existing, category);
    return category;
  }

  private async find(id: string, actor: Actor) {
    const category = await this.prisma.category.findFirst({
      where: { id, householdId: actor.householdId, active: true },
    });
    if (!category) throw new NotFoundException();
    return category;
  }

  private handleUnique(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictException("Ya existe una categoría con ese nombre");
    }
    throw error;
  }

  private audit(
    actor: Actor,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
  ) {
    const toJson = (value: unknown) =>
      value === null
        ? Prisma.JsonNull
        : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
    return this.prisma.auditLog.create({
      data: {
        householdId: actor.householdId,
        actorMemberId: actor.memberId,
        entityType: "Category",
        entityId,
        action,
        before: toJson(before),
        after: toJson(after),
      },
    });
  }
}
