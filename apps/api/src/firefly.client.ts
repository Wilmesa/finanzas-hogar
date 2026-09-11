import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Decimal } from "decimal.js";

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
      active?: boolean;
    };
  }>;
  meta?: { pagination?: { current_page: number; total_pages: number } };
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

  async findTransactionByReference(
    reference: string,
    date: string,
    scope: LedgerScope,
    memberId: string,
    expected?: {
      amount: string;
      currency: string;
      type: string;
      sourceId?: string | null;
      destinationId?: string | null;
    },
  ) {
    // Read-only recovery after an ambiguous POST: external_id is not a unique constraint in Firefly.
    const day = new Date(date);
    const start = new Date(day.getTime() - 86400000).toISOString().slice(0, 10);
    const end = new Date(day.getTime() + 86400000).toISOString().slice(0, 10);
    let page = 1;
    let totalPages = 1;
    const matches: string[] = [];
    do {
      const result = await this.request<{
        data: Array<{
          id: string;
          attributes: {
            transactions: Array<{
              internal_reference?: string | null;
              amount: string;
              currency_code: string;
              type: string;
              source_id?: string;
              destination_id?: string;
            }>;
          };
        }>;
        meta?: { pagination?: { total_pages: number } };
      }>(
        `/transactions?start=${start}&end=${end}&page=${page}`,
        scope,
        memberId,
      );
      for (const group of result.data) {
        const referenced = group.attributes.transactions.filter(
          (split) => split.internal_reference === reference,
        );
        if (!referenced.length) continue;
        const split = referenced[0]!;
        if (
          expected &&
          (group.attributes.transactions.length !== 1 ||
            !new Decimal(split.amount).equals(expected.amount) ||
            split.currency_code !== expected.currency ||
            split.type !== expected.type ||
            (expected.sourceId &&
              String(split.source_id) !== expected.sourceId) ||
            (expected.destinationId &&
              String(split.destination_id) !== expected.destinationId))
        )
          throw new ConflictException(
            "La referencia contable existe pero sus importes o cuentas cambiaron; requiere revisión",
          );
        matches.push(group.id);
      }
      totalPages = result.meta?.pagination?.total_pages ?? page;
      page += 1;
    } while (page <= totalPages);
    if (matches.length > 1)
      throw new ConflictException(
        "Hay más de un asiento con la misma referencia; requiere revisión",
      );
    return matches[0] ? { data: { id: matches[0] } } : null;
  }

  async listAssetAccounts(scope: LedgerScope, memberId: string) {
    const accounts: FireflyAccountResponse["data"] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const result = await this.request<FireflyAccountResponse>(
        `/accounts?type=asset&page=${page}`,
        scope,
        memberId,
      );
      accounts.push(
        ...result.data.filter((account) => account.attributes.active !== false),
      );
      totalPages = result.meta?.pagination?.total_pages ?? page;
      page += 1;
    } while (page <= totalPages);
    return accounts.map((account) => this.toAccount(account, scope));
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
