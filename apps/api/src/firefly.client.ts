import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

export type LedgerScope = "household" | "private";

interface FireflyAccountResponse {
  data: Array<{
    id: string;
    attributes: {
      name: string;
      type: string;
      account_role?: string;
      currency_code?: string;
      current_balance?: string;
    };
  }>;
}

interface FireflyAccountItemResponse {
  data: FireflyAccountResponse["data"][number];
}

export interface CreateFireflyAccountInput {
  name: string;
  type:
    | "cash"
    | "checking"
    | "savings"
    | "digital_wallet"
    | "credit_card"
    | "investment"
    | "other_asset"
    | "liability";
  currency: string;
  openingBalance?: string;
  openingBalanceDate?: string;
}

@Injectable()
export class FireflyClient {
  hasToken(scope: LedgerScope, memberId: string): boolean {
    return Boolean(this.tokenFor(scope, memberId));
  }

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
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (response.status >= 400 && response.status < 500) {
        throw new BadRequestException(
          detail?.message ?? "Firefly rechazó los datos enviados",
        );
      }
      throw new ServiceUnavailableException("Firefly no está disponible");
    }
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
    return result.data.map((account) => this.toAccount(account, scope));
  }

  async createAccount(
    input: CreateFireflyAccountInput,
    scope: LedgerScope,
    memberId: string,
  ) {
    const name = input.name.trim();
    const currency = input.currency.trim().toUpperCase();
    if (!name) throw new BadRequestException("El nombre es obligatorio");
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException("La moneda debe tener tres letras");
    }
    const type = input.type === "liability" ? "liability" : "asset";
    const result = await this.request<FireflyAccountItemResponse>(
      "/accounts",
      scope,
      memberId,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          type,
          currency_code: currency,
          ...(input.openingBalance !== undefined
            ? { opening_balance: input.openingBalance }
            : {}),
          ...(input.openingBalanceDate
            ? { opening_balance_date: input.openingBalanceDate }
            : {}),
          account_role:
            type === "asset" ? this.accountRole(input.type) : undefined,
          active: true,
        }),
      },
    );
    return this.toAccount(result.data, scope);
  }

  async updateAccount(
    id: string,
    input: { name?: string; currency?: string; active?: boolean },
    scope: LedgerScope,
    memberId: string,
  ) {
    if (input.name !== undefined && !input.name.trim()) {
      throw new BadRequestException("El nombre es obligatorio");
    }
    const result = await this.request<FireflyAccountItemResponse>(
      `/accounts/${encodeURIComponent(id)}`,
      scope,
      memberId,
      {
        method: "PUT",
        body: JSON.stringify({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.currency !== undefined
            ? { currency_code: input.currency.toUpperCase() }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        }),
      },
    );
    return this.toAccount(result.data, scope);
  }

  archiveAccount(id: string, scope: LedgerScope, memberId: string) {
    return this.updateAccount(id, { active: false }, scope, memberId);
  }

  async testConnection(scope: LedgerScope, memberId: string) {
    await this.request<unknown>("/about/user", scope, memberId);
    return { scope, status: "available" as const };
  }

  private accountRole(type: CreateFireflyAccountInput["type"]): string {
    if (type === "cash") return "cashWalletAsset";
    if (type === "savings") return "savingAsset";
    if (type === "credit_card") return "ccAsset";
    return "defaultAsset";
  }

  private toAccount(
    account: FireflyAccountResponse["data"][number],
    scope: LedgerScope,
  ) {
    return {
      id: account.id,
      name: account.attributes.name,
      type: this.simplifiedType(
        account.attributes.type,
        account.attributes.account_role,
      ),
      currency: account.attributes.currency_code ?? "COP",
      currentBalance: account.attributes.current_balance ?? "0",
      scope,
    };
  }

  private simplifiedType(type: string, role?: string): string {
    if (type === "liability" || type === "liabilities") return "liability";
    if (role === "cashWalletAsset") return "cash";
    if (role === "savingAsset") return "savings";
    if (role === "ccAsset") return "credit_card";
    return "checking";
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
