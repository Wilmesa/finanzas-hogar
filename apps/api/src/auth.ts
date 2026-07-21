import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { LocalAuthService } from "./local-auth.service.js";
import { SESSION_COOKIE, type StoredSession } from "./session-store.js";

export type AuthProvider = "local" | "keycloak" | "development";

export interface Actor {
  id: string;
  memberId: string;
  householdMemberId: string;
  householdId: string;
  displayName: string;
  email: string;
  role: "owner" | "member";
  roles: string[];
  authProvider: AuthProvider;
}

export interface AuthenticatedRequest extends FastifyRequest {
  actor?: Actor;
  authSession?: StoredSession;
  authSessionToken?: string;
}

export function authMode(): "local" | "keycloak" {
  return process.env.AUTH_MODE === "keycloak" ? "keycloak" : "local";
}

function safeTokenEqual(received: string | undefined, expected: string) {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class AuthenticationService {
  constructor(private readonly local: LocalAuthService) {}

  async authenticate(request: AuthenticatedRequest): Promise<Actor> {
    if (process.env.DEV_AUTH_ENABLED === "true") {
      const memberId = String(request.headers["x-member-id"] ?? "member-a");
      const role =
        request.headers["x-member-role"] === "owner" ? "owner" : "member";
      return {
        id: memberId,
        memberId,
        householdMemberId: memberId,
        householdId: String(
          request.headers["x-household-id"] ?? "household-demo",
        ),
        displayName: String(request.headers["x-member-name"] ?? "Miembro"),
        email: "development@example.invalid",
        role,
        roles: [role],
        authProvider: "development",
      };
    }

    if (authMode() === "local") {
      const token = request.cookies?.[SESSION_COOKIE];
      if (!token) throw new UnauthorizedException();
      const authenticated = await this.local.authenticate(token);
      if (!authenticated) throw new UnauthorizedException();
      request.authSession = authenticated.session;
      request.authSessionToken = token;
      const { user } = authenticated;
      const role = user.member.role === "owner" ? "owner" : "member";
      return {
        id: user.id,
        memberId: user.memberId,
        householdMemberId: user.memberId,
        householdId: user.member.householdId,
        displayName: user.member.displayName,
        email: user.email,
        role,
        roles: [role],
        authProvider: "local",
      };
    }

    const authorization = request.headers.authorization;
    const token = authorization?.replace(/^Bearer\s+/i, "");
    const issuer = process.env.KEYCLOAK_ISSUER;
    const audience = process.env.KEYCLOAK_AUDIENCE;
    if (!token || !issuer || !audience) throw new UnauthorizedException();
    const jwks = createRemoteJWKSet(
      new URL(
        process.env.KEYCLOAK_JWKS_URL ??
          `${issuer}/protocol/openid-connect/certs`,
      ),
    );
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    const householdId = payload.household_id;
    if (typeof payload.sub !== "string" || typeof householdId !== "string")
      throw new UnauthorizedException();
    const role = payload.household_role === "owner" ? "owner" : "member";
    return {
      id: payload.sub,
      memberId: payload.sub,
      householdMemberId: payload.sub,
      householdId,
      displayName: typeof payload.name === "string" ? payload.name : "Miembro",
      email: typeof payload.email === "string" ? payload.email : "",
      role,
      roles: [role],
      authProvider: "keycloak",
    };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authentication: AuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = request.url.split("?")[0] ?? "";
    if (
      path === "/health" ||
      path === "/v1/auth/login" ||
      path.startsWith("/v1/automation/")
    ) {
      return true;
    }
    request.actor = await this.authentication.authenticate(request);

    if (
      authMode() === "local" &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !safeTokenEqual(
        typeof request.headers["x-csrf-token"] === "string"
          ? request.headers["x-csrf-token"]
          : undefined,
        request.authSession?.csrfToken ?? "",
      )
    ) {
      throw new UnauthorizedException("Solicitud CSRF inválida");
    }
    return true;
  }
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().actor;
    if (!actor) throw new UnauthorizedException();
    return actor;
  },
);

export const CurrentAuthSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StoredSession | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authSession,
);

export const CurrentSessionToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authSessionToken,
);
