import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "./auth.controller.js";
import { AuthenticationService } from "./auth.js";
import type { AuthenticatedRequest } from "./auth.js";
import type { LocalAuthService } from "./local-auth.service.js";

describe("local authentication boundary", () => {
  it("uses a Secure HttpOnly SameSite=Strict cookie", () => {
    expect(sessionCookieOptions(3600)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 3600,
    });
  });

  it("rejects protected access without a session cookie", async () => {
    process.env.AUTH_MODE = "local";
    const local = {
      authenticate: async () => null,
    } as unknown as LocalAuthService;
    const authentication = new AuthenticationService(local);
    const request = {
      headers: {},
      cookies: {},
    } as unknown as AuthenticatedRequest;
    await expect(authentication.authenticate(request)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
