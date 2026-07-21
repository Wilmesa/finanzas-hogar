import { browser } from "$app/environment";
import { env } from "$env/dynamic/public";

const encoder = new TextEncoder();
let localCsrfToken: string | null = null;

export interface AuthenticatedUser {
  id: string;
  email: string;
  householdMemberId: string;
  displayName: string;
  roles: string[];
  authProvider: "local" | "keycloak" | "development";
  csrfToken?: string;
  sessionExpiresAt?: number;
}

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomValue(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes.buffer);
}

export function isServerMode(): boolean {
  return env.PUBLIC_DATA_MODE === "server";
}

export function authMode(): "local" | "keycloak" {
  return env.PUBLIC_AUTH_MODE === "keycloak" ? "keycloak" : "local";
}

function apiBase(): string {
  return env.PUBLIC_API_BASE_URL ?? "/api";
}

function keycloakBase(): string {
  return `${env.PUBLIC_KEYCLOAK_URL ?? "/auth"}/realms/${env.PUBLIC_KEYCLOAK_REALM ?? "finanzas"}`;
}

export async function login(): Promise<void> {
  if (authMode() === "local") return;
  const verifier = randomValue();
  const state = randomValue();
  const challenge = base64Url(
    await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
  );
  sessionStorage.setItem("oidc_verifier", verifier);
  sessionStorage.setItem("oidc_state", state);
  const query = new URLSearchParams({
    client_id: env.PUBLIC_KEYCLOAK_CLIENT_ID ?? "finanzas-web",
    redirect_uri: `${location.origin}/auth/callback`,
    response_type: "code",
    scope: "openid profile email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  location.assign(`${keycloakBase()}/protocol/openid-connect/auth?${query}`);
}

export async function loginLocal(
  identifier: string,
  password: string,
): Promise<AuthenticatedUser> {
  const response = await fetch(`${apiBase()}/v1/auth/login`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!response.ok) throw await responseError(response);
  const user = (await response.json()) as AuthenticatedUser;
  localCsrfToken = user.csrfToken ?? null;
  return user;
}

export async function completeLogin(url: URL): Promise<void> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = sessionStorage.getItem("oidc_state");
  const verifier = sessionStorage.getItem("oidc_verifier");
  if (!code || !state || state !== expectedState || !verifier) {
    throw new Error("Respuesta de autenticación inválida");
  }
  const response = await fetch(
    `${keycloakBase()}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.PUBLIC_KEYCLOAK_CLIENT_ID ?? "finanzas-web",
        redirect_uri: `${location.origin}/auth/callback`,
        code,
        code_verifier: verifier,
      }),
    },
  );
  if (!response.ok) throw new Error("Keycloak rechazó el código de acceso");
  saveToken((await response.json()) as TokenResponse);
  sessionStorage.removeItem("oidc_state");
  sessionStorage.removeItem("oidc_verifier");
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function saveToken(token: TokenResponse): void {
  sessionStorage.setItem("access_token", token.access_token);
  if (token.refresh_token)
    sessionStorage.setItem("refresh_token", token.refresh_token);
  sessionStorage.setItem(
    "access_token_expires_at",
    String(Date.now() + token.expires_in * 1000),
  );
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = sessionStorage.getItem("refresh_token");
  if (!refreshToken) return null;
  const response = await fetch(
    `${keycloakBase()}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: env.PUBLIC_KEYCLOAK_CLIENT_ID ?? "finanzas-web",
        refresh_token: refreshToken,
      }),
    },
  );
  if (!response.ok) return null;
  const token = (await response.json()) as TokenResponse;
  saveToken(token);
  return token.access_token;
}

export async function getAccessToken(): Promise<string | null> {
  if (!browser || !isServerMode() || authMode() === "local") return null;
  const token = sessionStorage.getItem("access_token");
  const expiresAt = Number(
    sessionStorage.getItem("access_token_expires_at") ?? 0,
  );
  if (token && expiresAt > Date.now() + 30_000) return token;
  return refreshAccessToken();
}

export function getCsrfToken(): string | null {
  return authMode() === "local" ? localCsrfToken : null;
}

export async function currentLocalUser(): Promise<AuthenticatedUser | null> {
  const response = await fetch(`${apiBase()}/v1/auth/me`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) {
    localCsrfToken = null;
    return null;
  }
  if (!response.ok) throw await responseError(response);
  const user = (await response.json()) as AuthenticatedUser;
  localCsrfToken = user.csrfToken ?? null;
  return user;
}

export async function isAuthenticated(): Promise<boolean> {
  if (!isServerMode()) return true;
  if (authMode() === "local") return Boolean(await currentLocalUser());
  return Boolean(await getAccessToken());
}

export async function changeLocalPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const response = await fetch(`${apiBase()}/v1/auth/change-password`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(localCsrfToken ? { "X-CSRF-Token": localCsrfToken } : {}),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) throw await responseError(response);
  localCsrfToken = null;
}

export async function logout(): Promise<void> {
  if (authMode() === "local") {
    await fetch(`${apiBase()}/v1/auth/logout`, {
      method: "POST",
      credentials: "same-origin",
      headers: localCsrfToken ? { "X-CSRF-Token": localCsrfToken } : {},
    });
    localCsrfToken = null;
  } else {
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("refresh_token");
    sessionStorage.removeItem("access_token_expires_at");
  }
  location.assign("/");
}

async function responseError(response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  const message = Array.isArray(payload?.message)
    ? payload.message.join(". ")
    : payload?.message;
  return new Error(message ?? `Error HTTP ${response.status}`);
}
