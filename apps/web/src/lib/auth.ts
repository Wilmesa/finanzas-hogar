import { browser } from "$app/environment";
import { env } from "$env/dynamic/public";

const encoder = new TextEncoder();

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

function keycloakBase(): string {
  return `${env.PUBLIC_KEYCLOAK_URL ?? "/auth"}/realms/${env.PUBLIC_KEYCLOAK_REALM ?? "finanzas"}`;
}

export async function login(): Promise<void> {
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
  if (!browser || !isServerMode()) return null;
  const token = sessionStorage.getItem("access_token");
  const expiresAt = Number(
    sessionStorage.getItem("access_token_expires_at") ?? 0,
  );
  if (token && expiresAt > Date.now() + 30_000) return token;
  return refreshAccessToken();
}

export async function isAuthenticated(): Promise<boolean> {
  return !isServerMode() || Boolean(await getAccessToken());
}

export function logout(): void {
  sessionStorage.clear();
  location.assign("/");
}
