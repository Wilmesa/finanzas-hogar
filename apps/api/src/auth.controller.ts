import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { IsString, Length } from "class-validator";
import type { FastifyReply } from "fastify";
import {
  authMode,
  CurrentActor,
  CurrentAuthSession,
  CurrentSessionToken,
  type Actor,
  type AuthenticatedRequest,
} from "./auth.js";
import { LocalAuthService } from "./local-auth.service.js";
import {
  SESSION_COOKIE,
  SessionStore,
  type StoredSession,
} from "./session-store.js";

export class LoginDto {
  @IsString()
  @Length(1, 254)
  identifier!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, 128)
  currentPassword!: string;

  @IsString()
  @Length(12, 128)
  newPassword!: string;
}

export function sessionCookieOptions(ttlSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: ttlSeconds,
  };
}

function publicUser(actor: Actor, session?: StoredSession) {
  return {
    id: actor.id,
    email: actor.email,
    householdMemberId: actor.householdMemberId,
    displayName: actor.displayName,
    roles: actor.roles,
    authProvider: actor.authProvider,
    csrfToken: session?.csrfToken,
    sessionExpiresAt: session?.expiresAt,
  };
}

@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly local: LocalAuthService,
    private readonly sessions: SessionStore,
  ) {}

  @Post("login")
  async login(
    @Body() body: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (authMode() !== "local") throw new NotFoundException();
    const { user, session } = await this.local.login(
      body.identifier,
      body.password,
      request.ip,
    );
    reply.setCookie(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions(session.ttl),
    );
    const role = user.member.role === "owner" ? "owner" : "member";
    return publicUser(
      {
        id: user.id,
        memberId: user.memberId,
        householdMemberId: user.memberId,
        householdId: user.member.householdId,
        displayName: user.member.displayName,
        email: user.email,
        role,
        roles: [role],
        authProvider: "local",
      },
      session.record,
    );
  }

  @Get("me")
  me(
    @CurrentActor() actor: Actor,
    @CurrentAuthSession() session: StoredSession | undefined,
  ) {
    return publicUser(actor, session);
  }

  @Post("logout")
  async logout(
    @CurrentSessionToken() token: string | undefined,
    @CurrentAuthSession() session: StoredSession | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (authMode() !== "local" || !token || !session)
      throw new UnauthorizedException();
    await this.local.logout(token, session);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { loggedOut: true };
  }

  @Post("renew")
  async renew(
    @CurrentSessionToken() token: string | undefined,
    @CurrentAuthSession() session: StoredSession | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentActor() actor: Actor,
  ) {
    if (authMode() !== "local" || !token || !session)
      throw new UnauthorizedException();
    const renewed = await this.local.renew(token, session);
    reply.setCookie(
      SESSION_COOKIE,
      renewed.token,
      sessionCookieOptions(renewed.ttl),
    );
    return publicUser(actor, renewed.record);
  }

  @Post("change-password")
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (authMode() !== "local") throw new NotFoundException();
    await this.local.changePassword(
      actor.id,
      body.currentPassword,
      body.newPassword,
    );
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { changed: true, loginRequired: true };
  }

  @Get("sessions")
  async sessionsList(@CurrentActor() actor: Actor) {
    if (authMode() !== "local") return { supported: false, sessions: [] };
    const sessions = await this.sessions.list(actor.memberId);
    return {
      supported: true,
      sessions: sessions.map((session) => ({
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
      })),
    };
  }

  @Post("logout-all")
  async logoutAll(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (authMode() !== "local") throw new NotFoundException();
    await this.sessions.destroyAll(actor.memberId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { loggedOut: true };
  }
}
