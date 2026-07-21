import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export type LedgerScope = "household" | "private";

interface FireflyAccountResponse {
  data: Array<{
    id: string;
    attributes: {
      name: string;
      type: string;
      currency_code?: string;
      current_balance?: string;
    };
  }>;
}

@Injectable()
export class FireflyClient {
  private tokenFor(scope: LedgerScope, memberId: string): string {
    if (scope === "household") return process.env.FIREFLY_HOUSEHOLD_TOKEN ?? "";
    if (memberId === (process.env.MEMBER_A_ID ?? "member-a")) {
      return process.env.FIREFLY_PRIVATE_TOKEN_MEMBER_A ?? "";
    }
    if (memberId === (process.env.MEMBER_B_ID ?? "member-b")) {
      return process.env.FIREFLY_PRIVATE_TOKEN_MEMBER_B ?? "";
    }
    const normalized = memberId.toUpperCase().replaceAll("-", "_");
    return process.env[`FIREFLY_PRIVATE_TOKEN_${normalized}`] ?? "";
  }

  async request<T>(
    path: string,
    scope: LedgerScope,
    memberId: string,
    init?: RequestInit,
  ): Promise<T> {
    const baseUrl = process.env.FIREFLY_BASE_URL;
    const token = this.tokenFor(scope, memberId);
    if (!baseUrl || !token)
      throw new ServiceUnavailableException(
        "Firefly no está configurado para este libro",
      );
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        `Firefly respondió ${response.status}`,
      );
    return (await response.json()) as T;
  }

  createTransaction(input: unknown, scope: LedgerScope, memberId: string) {
    return this.request<{ data: { id: string } }>(
      "/transactions",
      scope,
      memberId,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  async listAssetAccounts(scope: LedgerScope, memberId: string) {
    const result = await this.request<FireflyAccountResponse>(
      "/accounts?type=asset",
      scope,
      memberId,
    );
    return result.data.map((account) => ({
      id: account.id,
      name: account.attributes.name,
      type: account.attributes.type,
      currency: account.attributes.currency_code ?? "COP",
      currentBalance: account.attributes.current_balance ?? "0",
      scope,
    }));
  }

  getInsight(
    path: string,
    query: URLSearchParams,
    scope: LedgerScope,
    memberId: string,
  ) {
    return this.request<unknown>(
      `/insight/${path}?${query.toString()}`,
      scope,
      memberId,
    );
  }
}
