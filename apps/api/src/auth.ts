import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Actor {
  memberId: string;
  householdId: string;
  displayName: string;
  role: "owner" | "member";
}

interface AuthenticatedRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  actor?: Actor;
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = request.url.split("?")[0] ?? "";
    if (path === "/health" || path.startsWith("/v1/automation/")) return true;

    if (process.env.DEV_AUTH_ENABLED === "true") {
      request.actor = {
        memberId: String(request.headers["x-member-id"] ?? "member-a"),
        householdId: String(
          request.headers["x-household-id"] ?? "household-demo",
        ),
        displayName: String(request.headers["x-member-name"] ?? "Ana"),
        role: request.headers["x-member-role"] === "owner" ? "owner" : "member",
      };
      return true;
    }

    const authorization = request.headers.authorization;
    const token =
      typeof authorization === "string"
        ? authorization.replace(/^Bearer\s+/i, "")
        : undefined;
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
    request.actor = {
      memberId: payload.sub,
      householdId,
      displayName: typeof payload.name === "string" ? payload.name : "Miembro",
      role: payload.household_role === "owner" ? "owner" : "member",
    };
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
