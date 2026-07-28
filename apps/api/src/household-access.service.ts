import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { hashPassword } from "./password.js";
import { PrismaService } from "./prisma.service.js";
import { SessionStore } from "./session-store.js";

const CredentialsSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email().max(254),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/),
  password: z.string().min(12).max(128),
});

const SetupSchema = CredentialsSchema.extend({
  householdName: z.string().trim().min(2).max(80),
});

const JoinSchema = CredentialsSchema.extend({
  token: z.string().min(32).max(128),
});

@Injectable()
export class HouseholdAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionStore,
  ) {}

  async setupStatus() {
    return {
      registrationAvailable: (await this.prisma.localUser.count()) === 0,
    };
  }

  async setup(raw: unknown) {
    const input = this.parse(SetupSchema, raw);
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.prisma.$transaction(
        async (tx) => {
          if ((await tx.localUser.count()) !== 0) {
            throw new ConflictException(
              "OKLE ya tiene un hogar. Pide una invitación a su propietario.",
            );
          }
          const household = await tx.household.create({
            data: {
              name: input.householdName,
              integrationPreference: { create: {} },
            },
          });
          const memberId = randomUUID();
          const member = await tx.member.create({
            data: {
              id: memberId,
              householdId: household.id,
              displayName: input.displayName,
              email: input.email,
              role: "owner",
              color: "#123C69",
            },
          });
          const localUser = await tx.localUser.create({
            data: {
              memberId,
              email: input.email,
              username: input.username,
              passwordHash,
            },
          });
          return { ...localUser, member };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.withSession(user);
    } catch (cause) {
      this.rethrowFriendly(cause);
    }
  }

  async createInvitation(actor: Actor) {
    if (actor.role !== "owner") throw new UnauthorizedException();
    const memberCount = await this.prisma.member.count({
      where: { householdId: actor.householdId },
    });
    if (memberCount >= 2) {
      throw new ConflictException("El hogar ya tiene sus dos miembros");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.$transaction([
      this.prisma.householdInvitation.updateMany({
        where: {
          householdId: actor.householdId,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { expiresAt: new Date() },
      }),
      this.prisma.householdInvitation.create({
        data: {
          householdId: actor.householdId,
          createdByMemberId: actor.memberId,
          tokenHash: this.tokenHash(token),
          expiresAt,
        },
      }),
    ]);
    return { token, expiresAt };
  }

  async invitation(token: string) {
    const invitation = await this.validInvitation(token);
    return {
      householdName: invitation.household.name,
      expiresAt: invitation.expiresAt,
    };
  }

  async join(raw: unknown) {
    const input = this.parse(JoinSchema, raw);
    const passwordHash = await hashPassword(input.password);
    const tokenHash = this.tokenHash(input.token);
    try {
      const user = await this.prisma.$transaction(
        async (tx) => {
          const invitation = await tx.householdInvitation.findUnique({
            where: { tokenHash },
            include: { household: true },
          });
          if (
            !invitation ||
            invitation.usedAt ||
            invitation.expiresAt <= new Date()
          ) {
            throw new NotFoundException(
              "La invitación no existe, venció o ya fue utilizada",
            );
          }
          if (
            (await tx.member.count({
              where: { householdId: invitation.householdId },
            })) >= 2
          ) {
            throw new ConflictException("El hogar ya tiene sus dos miembros");
          }
          const consumed = await tx.householdInvitation.updateMany({
            where: { id: invitation.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          if (consumed.count !== 1) {
            throw new ConflictException("La invitación ya fue utilizada");
          }
          const memberId = randomUUID();
          const member = await tx.member.create({
            data: {
              id: memberId,
              householdId: invitation.householdId,
              displayName: input.displayName,
              email: input.email,
              role: "member",
              color: "#F4B942",
            },
          });
          const localUser = await tx.localUser.create({
            data: {
              memberId,
              email: input.email,
              username: input.username,
              passwordHash,
            },
          });
          return { ...localUser, member };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.withSession(user);
    } catch (cause) {
      this.rethrowFriendly(cause);
    }
  }

  private async validInvitation(token: string) {
    if (token.length < 32 || token.length > 128) {
      throw new NotFoundException("La invitación no es válida");
    }
    const invitation = await this.prisma.householdInvitation.findUnique({
      where: { tokenHash: this.tokenHash(token) },
      include: { household: true },
    });
    if (
      !invitation ||
      invitation.usedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw new NotFoundException(
        "La invitación no existe, venció o ya fue utilizada",
      );
    }
    return invitation;
  }

  private async withSession<
    T extends {
      id: string;
      memberId: string;
      email: string;
      member: {
        id: string;
        householdId: string;
        displayName: string;
        role: string;
      };
    },
  >(user: T) {
    const session = await this.sessions.create({
      userId: user.id,
      memberId: user.memberId,
      householdId: user.member.householdId,
      passwordVersion: 1,
    });
    return { user, session };
  }

  private parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new BadRequestException({
        message: "Revisa los datos e inténtalo nuevamente",
        fields: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }

  private tokenHash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private rethrowFriendly(cause: unknown): never {
    if (
      cause instanceof BadRequestException ||
      cause instanceof ConflictException ||
      cause instanceof NotFoundException ||
      cause instanceof UnauthorizedException
    ) {
      throw cause;
    }
    if (
      cause instanceof Prisma.PrismaClientKnownRequestError &&
      (cause.code === "P2002" || cause.code === "P2034")
    ) {
      throw new ConflictException(
        "Ese correo o usuario ya está en uso. Elige otro.",
      );
    }
    throw cause;
  }
}
