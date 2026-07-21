import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "./prisma.service.js";
import { hashPassword, verifyPassword, validatePassword } from "./password.js";
import { SessionStore, type StoredSession } from "./session-store.js";

const INVALID_CREDENTIALS = "Credenciales incorrectas";

@Injectable()
export class LocalAuthService {
  private readonly dummyHash = hashPassword(
    randomBytes(24).toString("base64url"),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionStore,
  ) {}

  async login(identifier: string, password: string, ip: string) {
    const normalized = identifier.trim().toLowerCase();
    if (!(await this.sessions.consumeLoginAttempt(normalized, ip))) {
      throw new HttpException(
        "Demasiados intentos. Espera antes de volver a intentar.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.localUser.findFirst({
      where: {
        OR: [
          { email: { equals: normalized, mode: "insensitive" } },
          { username: { equals: normalized, mode: "insensitive" } },
        ],
      },
      include: { member: true },
    });
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !user.isActive || !valid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    await this.sessions.clearLoginAttempts(normalized, ip);
    const session = await this.sessions.create({
      userId: user.id,
      memberId: user.memberId,
      householdId: user.member.householdId,
      passwordVersion: user.passwordVersion,
    });
    return { user, session };
  }

  async authenticate(token: string) {
    const session = await this.sessions.get(token);
    if (!session) return null;
    const user = await this.prisma.localUser.findUnique({
      where: { id: session.userId },
      include: { member: true },
    });
    if (
      !user ||
      !user.isActive ||
      user.memberId !== session.memberId ||
      user.member.householdId !== session.householdId ||
      user.passwordVersion !== session.passwordVersion
    ) {
      await this.sessions.destroy(token, session.memberId);
      return null;
    }
    return { user, session };
  }

  async logout(token: string, session: StoredSession) {
    await this.sessions.destroy(token, session.memberId);
  }

  async renew(token: string, session: StoredSession) {
    const authenticated = await this.authenticate(token);
    if (!authenticated) throw new UnauthorizedException();
    await this.sessions.destroy(token, session.memberId);
    return this.sessions.create({
      userId: authenticated.user.id,
      memberId: authenticated.user.memberId,
      householdId: authenticated.user.member.householdId,
      passwordVersion: authenticated.user.passwordVersion,
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    validatePassword(newPassword);
    const user = await this.prisma.localUser.findUnique({
      where: { id: userId },
    });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw new UnauthorizedException("La nueva contraseña debe ser diferente");
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.localUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordVersion: { increment: 1 },
        passwordChangedAt: new Date(),
      },
    });
    await this.sessions.destroyAll(user.memberId);
  }
}
