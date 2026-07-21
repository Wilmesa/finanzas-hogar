import { env } from "$env/dynamic/public";
import { authMode, getAccessToken, getCsrfToken } from "./auth";

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  const csrfToken = getCsrfToken();
  const method = (init.method ?? "GET").toUpperCase();
  const response = await fetch(`${env.PUBLIC_API_BASE_URL ?? "/api"}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(authMode() === "local" &&
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      csrfToken
        ? { "X-CSRF-Token": csrfToken }
        : {}),
      ...init.headers,
    },
  });
  if (response.status === 401) {
    if (authMode() === "local" && typeof window !== "undefined")
      window.location.assign("/");
    throw new Error("La sesión expiró. Inicia sesión de nuevo.");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    throw new Error(
      payload?.message ?? payload?.error ?? `Error HTTP ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}
