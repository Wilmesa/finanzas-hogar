import { env } from "$env/dynamic/public";
import { getAccessToken } from "./auth";

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${env.PUBLIC_API_BASE_URL ?? "/api"}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401) {
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
