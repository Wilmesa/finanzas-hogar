import { Injectable, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class AiCfoClient {
  async status(): Promise<{
    status: string;
    provider: string;
    providerName?: string;
    model: string | null;
    keyPresent: boolean;
    generationEnabled: boolean;
  }> {
    const url = process.env.AI_CFO_URL;
    if (!url) {
      return {
        status: "unavailable",
        provider: "disabled",
        providerName: "disabled",
        model: null,
        keyPresent: false,
        generationEnabled: false,
      };
    }
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("unhealthy");
      return (await response.json()) as {
        status: string;
        provider: string;
        providerName?: string;
        model: string | null;
        keyPresent: boolean;
        generationEnabled: boolean;
      };
    } catch {
      return {
        status: "unavailable",
        provider: process.env.AI_PROVIDER ?? "disabled",
        providerName:
          process.env.AI_COMPATIBLE_PROVIDER_NAME ??
          process.env.AI_PROVIDER ??
          "disabled",
        model: process.env.OPENAI_MODEL ?? null,
        keyPresent: false,
        generationEnabled: false,
      };
    }
  }

  async generate(snapshot: unknown): Promise<unknown> {
    const url = process.env.AI_CFO_URL;
    const token = process.env.AI_CFO_INTERNAL_TOKEN;
    if (!url || !token)
      throw new ServiceUnavailableException("AI-CFO no está configurado");
    const response = await fetch(`${url}/internal/v1/insights/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": token,
      },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        `AI-CFO respondió ${response.status}`,
      );
    return response.json();
  }
}
