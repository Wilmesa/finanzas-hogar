import { browser } from "$app/environment";
import { get, writable } from "svelte/store";
import { apiRequest } from "./api";
import { isServerMode } from "./auth";
import {
  pockets as demoPockets,
  transactions as demoTransactions,
} from "./demo";
import type {
  AccountView,
  AccountConnectionView,
  AiStatusView,
  CategoryView,
  ChatMessageView,
  ExpectedIncomeView,
  FinanceState,
  FundingPlanView,
  IncomeSourceView,
  InsightView,
  MemberView,
  PlanRevisionView,
  PocketView,
  TransactionView,
} from "./types";

const STORAGE_KEY = "okle:v3";
const LEGACY_STORAGE_KEY = "finnest:v3";
const defaultCategories: CategoryView[] = [
  {
    id: "category-market",
    name: "Mercado",
    icon: "shopping-cart",
    color: "#123C69",
  },
  {
    id: "category-transport",
    name: "Transporte",
    icon: "bus",
    color: "#4C8DFF",
  },
  {
    id: "category-restaurants",
    name: "Restaurantes",
    icon: "utensils",
    color: "#B9862E",
  },
  { id: "category-home", name: "Vivienda", icon: "home", color: "#6B7280" },
  {
    id: "category-health",
    name: "Salud",
    icon: "heart-pulse",
    color: "#D64550",
  },
  { id: "category-other", name: "Otros", icon: "tag", color: "#5B6B79" },
];
const demoInitial: FinanceState = {
  schemaVersion: 3,
  pockets: structuredClone(demoPockets),
  transactions: structuredClone(demoTransactions),
  accounts: [
    {
      id: "local-household",
      name: "Cuenta del hogar (demo)",
      type: "asset",
      currency: "COP",
      currentBalance: 50_000_000,
      scope: "household",
    },
    {
      id: "local-private",
      name: "Cuenta personal (demo)",
      type: "asset",
      currency: "COP",
      currentBalance: 2_000_000,
      scope: "private",
    },
  ],
  accountConnections: [
    { scope: "household", configured: true, status: "available" },
    { scope: "private", configured: true, status: "available" },
  ],
  members: [
    {
      id: "demo-me",
      displayName: "Tú",
      email: "demo@example.invalid",
      role: "owner",
      color: "#059669",
    },
    {
      id: "demo-partner",
      displayName: "Pareja",
      email: "pareja@example.invalid",
      role: "member",
      color: "#2563EB",
    },
  ],
  insights: [],
  categories: structuredClone(defaultCategories),
  aiStatus: {
    status: "demo",
    provider: "deterministic",
    model: "demo",
    keyPresent: true,
    generationEnabled: true,
  },
  incomeSources: [
    {
      id: "source-salary",
      name: "Salario mensual",
      kind: "salary",
      visibility: "household",
      currency: "COP",
      recurrence: "monthly",
      defaultAmount: 8_000_000,
      description: "Ingreso ordinario del hogar",
    },
    {
      id: "source-bonus",
      name: "Prima de fin de año",
      kind: "bonus_endyear",
      visibility: "household",
      currency: "COP",
      recurrence: "annual",
      defaultAmount: 6_000_000,
      description: "Ingreso extraordinario para decisiones acordadas",
    },
  ],
  expectedIncomes: [
    {
      id: "income-bonus-december",
      sourceId: "source-bonus",
      sourceName: "Prima de fin de año",
      expectedDate: "2026-12-15",
      expectedAmount: 6_000_000,
      currency: "COP",
      status: "planned",
      probability: 0.9,
      reason: "Prima legal estimada de diciembre",
      notes: "Confirmar el valor con el desprendible antes de aplicar el plan.",
      timeBucket: "future",
    },
  ],
  fundingPlans: [
    {
      id: "plan-bonus-december",
      title: "Acuerdo para la prima de diciembre",
      purpose:
        "Fortalecer vivienda y reservar una parte para los gastos de cierre de año.",
      horizon: "short_term",
      visibility: "household",
      currency: "COP",
      status: "agreed",
      startDate: "2026-07-20",
      targetDate: "2026-12-15",
      version: 1,
      allocations: [
        {
          id: "allocation-bonus-home",
          expectedIncomeId: "income-bonus-december",
          pocketId: "home",
          pocketName: "Cuota inicial",
          sourceName: "Prima de fin de año",
          mode: "fixed",
          value: 4_000_000,
          priority: 1,
          rationale:
            "Acercar la cuota inicial sin usar el presupuesto ordinario.",
        },
        {
          id: "allocation-bonus-daily",
          expectedIncomeId: "income-bonus-december",
          pocketId: "daily",
          pocketName: "Vida diaria",
          sourceName: "Prima de fin de año",
          mode: "remainder",
          priority: 2,
          rationale:
            "El remanente cubre celebraciones y gastos familiares de diciembre.",
        },
      ],
      revisions: [
        {
          version: 1,
          decisionNote:
            "Acordamos priorizar vivienda y reservar el remanente para diciembre.",
          createdAt: "2026-07-20T10:00:00.000Z",
          actorName: "Tú",
        },
      ],
    },
  ],
  settings: {
    memberName: "Tú",
    memberId: "demo-me",
    memberEmail: "demo@example.invalid",
    memberRole: "owner",
    memberColor: "#059669",
    householdName: "Nuestro hogar",
    baseCurrency: "COP",
    dailyReminder: "20:00",
  },
};

const serverInitial: FinanceState = {
  schemaVersion: 3,
  pockets: [],
  transactions: [],
  accounts: [],
  accountConnections: [],
  members: [],
  insights: [],
  categories: [],
  aiStatus: {
    status: "unknown",
    provider: "disabled",
    model: null,
    keyPresent: false,
    generationEnabled: false,
  },
  incomeSources: [],
  expectedIncomes: [],
  fundingPlans: [],
  settings: {
    memberName: "",
    memberId: "",
    memberEmail: "",
    memberRole: "member",
    memberColor: "#059669",
    householdName: "",
    baseCurrency: "COP",
    dailyReminder: "20:00",
  },
};

const initial = browser && isServerMode() ? serverInitial : demoInitial;

function readLocal(): FinanceState {
  if (!browser) return initial;
  const raw =
    localStorage.getItem(STORAGE_KEY) ??
    localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return initial;
  try {
    const parsed = JSON.parse(raw) as Omit<
      Partial<FinanceState>,
      "schemaVersion"
    > & {
      schemaVersion?: number;
    };
    if (![1, 2, 3].includes(parsed.schemaVersion ?? 0)) return initial;
    return {
      ...initial,
      ...parsed,
      schemaVersion: 3,
      accounts: parsed.accounts ?? initial.accounts,
      categories: parsed.categories ?? initial.categories,
      accountConnections:
        parsed.accountConnections ?? initial.accountConnections,
      members: parsed.members ?? initial.members,
      insights: parsed.insights ?? initial.insights,
      aiStatus: parsed.aiStatus ?? initial.aiStatus,
      incomeSources: parsed.incomeSources ?? initial.incomeSources,
      expectedIncomes: parsed.expectedIncomes ?? initial.expectedIncomes,
      fundingPlans: parsed.fundingPlans ?? initial.fundingPlans,
    };
  } catch {
    return initial;
  }
}

export const financeData = writable<FinanceState>(readLocal());

if (browser) {
  financeData.subscribe((value) => {
    if (!isServerMode())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  });
}

function serverPocketToView(item: Record<string, unknown>): PocketView {
  const policy = item.policy as Record<string, string>;
  const targetAmount = Number(policy.targetAmount ?? policy.limit ?? 0);
  const currentAmount = Number(item.currentAmount ?? 0);
  return {
    id: String(item.id),
    ownerMemberId: String(item.ownerMemberId),
    name: String(item.name),
    purpose: String(item.purpose),
    visibility: item.visibility === "private" ? "private" : "household",
    currency: String(item.currency),
    currentAmount,
    targetAmount,
    color: item.visibility === "private" ? "rose" : "mint",
    note:
      targetAmount > 0
        ? `${Math.round((currentAmount / targetAmount) * 100)} % completado`
        : "Sin meta",
    policyKind: policy.kind as PocketView["policyKind"],
    targetDate: policy.targetDate,
    monthlyContribution: Number(policy.contributionAmount ?? 0) || undefined,
    version: Number(item.version ?? 1),
    status: (item.status as PocketView["status"]) ?? "active",
  };
}

function serverIncomeSourceToView(
  item: Record<string, unknown>,
): IncomeSourceView {
  return {
    id: String(item.id),
    name: String(item.name),
    kind: String(item.kind),
    visibility: item.visibility === "private" ? "private" : "household",
    currency: String(item.currency),
    recurrence: String(item.recurrence),
    ...(item.defaultAmount !== null && item.defaultAmount !== undefined
      ? { defaultAmount: Number(item.defaultAmount) }
      : {}),
    ...(item.description ? { description: String(item.description) } : {}),
    ...(item.updatedAt ? { updatedAt: String(item.updatedAt) } : {}),
  };
}

function serverExpectedIncomeToView(
  item: Record<string, unknown>,
): ExpectedIncomeView {
  const source = item.source as Record<string, unknown>;
  return {
    id: String(item.id),
    sourceId: String(item.sourceId),
    sourceName: String(source.name),
    expectedDate: String(item.expectedDate).slice(0, 10),
    expectedAmount: Number(item.expectedAmount),
    ...(item.actualAmount !== null && item.actualAmount !== undefined
      ? { actualAmount: Number(item.actualAmount) }
      : {}),
    currency: String(item.currency),
    status: item.status as ExpectedIncomeView["status"],
    probability: Number(item.probability),
    reason: String(item.reason),
    ...(item.notes ? { notes: String(item.notes) } : {}),
    timeBucket: item.timeBucket as ExpectedIncomeView["timeBucket"],
    ...(item.updatedAt ? { updatedAt: String(item.updatedAt) } : {}),
  };
}

function serverFundingPlanToView(
  item: Record<string, unknown>,
): FundingPlanView {
  const allocations = (item.allocations ?? []) as Record<string, unknown>[];
  const revisions = (item.revisions ?? []) as Record<string, unknown>[];
  return {
    id: String(item.id),
    title: String(item.title),
    purpose: String(item.purpose),
    horizon: item.horizon as FundingPlanView["horizon"],
    visibility: item.visibility === "private" ? "private" : "household",
    currency: String(item.currency),
    status: item.status as FundingPlanView["status"],
    startDate: String(item.startDate).slice(0, 10),
    ...(item.targetDate
      ? { targetDate: String(item.targetDate).slice(0, 10) }
      : {}),
    version: Number(item.version),
    ...(item.updatedAt ? { updatedAt: String(item.updatedAt) } : {}),
    allocations: allocations.map((allocation) => {
      const income = allocation.expectedIncome as Record<string, unknown>;
      const source = income.source as Record<string, unknown>;
      const pocket = allocation.pocket as Record<string, unknown> | null;
      const payment = allocation.paymentPlan as Record<string, unknown> | null;
      return {
        id: String(allocation.id),
        expectedIncomeId: String(allocation.expectedIncomeId),
        ...(allocation.pocketId
          ? { pocketId: String(allocation.pocketId) }
          : {}),
        ...(allocation.paymentPlanId
          ? { paymentPlanId: String(allocation.paymentPlanId) }
          : {}),
        pocketName: String(pocket?.name ?? payment?.name ?? "Destino"),
        sourceName: String(source.name),
        mode: allocation.mode as "fixed" | "percentage" | "remainder",
        ...(allocation.value !== null && allocation.value !== undefined
          ? { value: Number(allocation.value) }
          : {}),
        priority: Number(allocation.priority),
        rationale: String(allocation.rationale),
        status: (allocation.status ?? "planned") as
          "planned" | "partial" | "applied",
        executedAmount: Number(allocation.executedAmount ?? 0),
      };
    }),
    revisions: revisions.map((revision) => ({
      version: Number(revision.version),
      decisionNote: String(revision.decisionNote),
      createdAt: String(revision.createdAt),
    })),
  };
}

export async function hydrateFinanceData(): Promise<void> {
  if (!browser || !isServerMode()) return;
  const [
    pockets,
    transactions,
    accountResult,
    planning,
    household,
    insights,
    aiStatus,
    categories,
  ] = await Promise.all([
    apiRequest<Record<string, unknown>[]>("/v1/pockets"),
    apiRequest<Record<string, unknown>[]>("/v1/transactions"),
    apiRequest<{
      accounts: Record<string, unknown>[];
      connections: AccountConnectionView[];
    }>("/v1/accounts"),
    apiRequest<Record<string, unknown>>("/v1/planning"),
    apiRequest<Record<string, unknown>>("/v1/household"),
    apiRequest<InsightView[]>("/v1/insights"),
    apiRequest<AiStatusView>("/v1/ai-cfo/status"),
    apiRequest<CategoryView[]>("/v1/categories"),
  ]);
  const planningSources = (planning.sources ?? []) as Record<string, unknown>[];
  const planningIncomes = (planning.incomes ?? []) as Record<string, unknown>[];
  const planningPlans = (planning.plans ?? []) as Record<string, unknown>[];
  financeData.update((state) => ({
    ...state,
    pockets: pockets.map(serverPocketToView),
    accounts: accountResult.accounts.map((item): AccountView => ({
      id: String(item.id),
      name: String(item.name),
      type: String(item.type),
      currency: String(item.currency),
      currentBalance: Number(item.currentBalance),
      scope: item.scope === "private" ? "private" : "household",
    })),
    accountConnections: accountResult.connections,
    members: ((household.members ?? []) as Record<string, unknown>[]).map(
      (member): MemberView => ({
        id: String(member.id),
        displayName: String(member.displayName),
        email: String(member.email),
        username: member.username ? String(member.username) : null,
        role: member.role === "owner" ? "owner" : "member",
        avatar: member.avatar ? String(member.avatar) : null,
        color: String(member.color ?? "#059669"),
      }),
    ),
    insights,
    aiStatus,
    categories,
    settings: {
      ...state.settings,
      memberName:
        ((household.members ?? []) as Record<string, unknown>[])
          .find((member) => member.id === household.currentMemberId)
          ?.displayName?.toString() ?? "",
      memberId: String(household.currentMemberId),
      memberEmail:
        ((household.members ?? []) as Record<string, unknown>[])
          .find((member) => member.id === household.currentMemberId)
          ?.email?.toString() ?? "",
      memberRole: household.currentRole === "owner" ? "owner" : "member",
      memberAvatar:
        ((household.members ?? []) as Record<string, unknown>[])
          .find((member) => member.id === household.currentMemberId)
          ?.avatar?.toString() ?? null,
      memberColor:
        ((household.members ?? []) as Record<string, unknown>[])
          .find((member) => member.id === household.currentMemberId)
          ?.color?.toString() ?? "#059669",
      householdName: String(household.name),
      baseCurrency: String(household.baseCurrency),
    },
    incomeSources: planningSources.map(serverIncomeSourceToView),
    expectedIncomes: planningIncomes.map(serverExpectedIncomeToView),
    fundingPlans: planningPlans.map(serverFundingPlanToView),
    transactions: transactions.map((item) => ({
      id: String(item.id),
      merchant: String(item.merchant ?? "Movimiento"),
      category: String(item.category ?? "Sin categoría"),
      pocket:
        pockets
          .find((pocket) => pocket.id === item.pocketId)
          ?.name?.toString() ?? "Sin bolsillo",
      pocketId: String(item.pocketId ?? ""),
      payer: String(
        (item.payer as Record<string, unknown> | undefined)?.displayName ??
          "Miembro",
      ),
      amount: Number(item.amount),
      currency: String(item.currency),
      kind: "expense",
      date: new Date(String(item.occurredAt)).toLocaleDateString("es-CO"),
      occurredAt: String(item.occurredAt),
    })),
  }));
}

export async function createPocket(input: {
  name: string;
  purpose: string;
  visibility: PocketView["visibility"];
  currency: string;
  targetAmount: number;
  policyKind: NonNullable<PocketView["policyKind"]>;
  targetDate?: string;
  monthlyContribution?: number;
}): Promise<string> {
  if (isServerMode()) {
    const policy =
      input.policyKind === "target_by_date"
        ? {
            kind: input.policyKind,
            targetAmount: String(input.targetAmount),
            targetDate: input.targetDate,
            frequency: "monthly",
          }
        : input.policyKind === "target_by_contribution"
          ? {
              kind: input.policyKind,
              targetAmount: String(input.targetAmount),
              contributionAmount: String(input.monthlyContribution),
              frequency: "monthly",
            }
          : {
              kind: input.policyKind,
              limit: String(input.targetAmount),
              period: "monthly",
            };
    const created = await apiRequest<Record<string, unknown>>("/v1/pockets", {
      method: "POST",
      body: JSON.stringify({ ...input, policy }),
    });
    financeData.update((state) => ({
      ...state,
      pockets: [serverPocketToView(created), ...state.pockets],
    }));
    return String(created.id);
  }
  const pocket: PocketView = {
    id: crypto.randomUUID(),
    name: input.name,
    purpose: input.purpose,
    visibility: input.visibility,
    currency: input.currency,
    currentAmount: 0,
    targetAmount: input.targetAmount,
    color: input.visibility === "private" ? "rose" : "mint",
    note: "Nuevo · 0 % completado",
    policyKind: input.policyKind,
    targetDate: input.targetDate,
    monthlyContribution: input.monthlyContribution,
  };
  financeData.update((state) => ({
    ...state,
    pockets: [pocket, ...state.pockets],
  }));
  return pocket.id;
}

export async function updatePocket(
  pocket: PocketView,
  input: {
    name: string;
    purpose: string;
    visibility: PocketView["visibility"];
    targetAmount: number;
    policyKind: NonNullable<PocketView["policyKind"]>;
    targetDate?: string;
    monthlyContribution?: number;
  },
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      pockets: state.pockets.map((item) =>
        item.id === pocket.id
          ? { ...item, ...input, version: (item.version ?? 1) + 1 }
          : item,
      ),
    }));
    return;
  }
  const policy =
    input.policyKind === "target_by_date"
      ? {
          kind: input.policyKind,
          targetAmount: String(input.targetAmount),
          targetDate: input.targetDate,
          frequency: "monthly",
        }
      : input.policyKind === "target_by_contribution"
        ? {
            kind: input.policyKind,
            targetAmount: String(input.targetAmount),
            contributionAmount: String(input.monthlyContribution),
            frequency: "monthly",
          }
        : {
            kind: input.policyKind,
            limit: String(input.targetAmount),
            period: "monthly",
          };
  await apiRequest(`/v1/pockets/${pocket.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: input.name,
      purpose: input.purpose,
      visibility: input.visibility,
      policy,
      version: pocket.version ?? 1,
    }),
  });
  await hydrateFinanceData();
}

export async function archivePocket(
  pocket: PocketView,
  input: {
    disposition?: "transfer" | "release";
    destinationPocketId?: string;
  },
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => {
      const destination = input.destinationPocketId;
      return {
        ...state,
        pockets: state.pockets
          .filter((item) => item.id !== pocket.id)
          .map((item) =>
            destination === item.id
              ? {
                  ...item,
                  currentAmount: item.currentAmount + pocket.currentAmount,
                }
              : item,
          ),
      };
    });
    return;
  }
  await apiRequest(`/v1/pockets/${pocket.id}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
  await hydrateFinanceData();
}

export async function createTransaction(input: {
  amount: number;
  pocketId: string;
  merchant: string;
  category: string;
  payerMemberId: string;
  accountId?: string;
  kind?: TransactionView["kind"];
}): Promise<void> {
  const state = get(financeData);
  const pocket = state.pockets.find((item) => item.id === input.pocketId);
  if (!pocket) throw new Error("Selecciona un bolsillo válido");
  const kind = input.kind ?? "expense";
  if (isServerMode()) {
    const accountScope = pocket.visibility;
    const account = state.accounts.find(
      (item) => item.id === input.accountId && item.scope === accountScope,
    );
    if (!account) {
      throw new Error("Selecciona una cuenta compatible con el bolsillo");
    }
    await apiRequest("/v1/transactions", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        type: kind === "income" ? "deposit" : "withdrawal",
        amount: String(input.amount),
        currency: pocket.currency,
        description: input.merchant,
        category: input.category,
        pocketId: pocket.id,
        occurredAt: new Date().toISOString(),
        fundingSourceScope: pocket.visibility,
        payerMemberId: input.payerMemberId,
        sourceId: kind === "expense" ? account.id : undefined,
        destinationId: kind === "income" ? account.id : undefined,
      }),
    });
    await hydrateFinanceData();
    return;
  }
  const transaction: TransactionView = {
    id: crypto.randomUUID(),
    merchant: input.merchant,
    category: input.category,
    pocket: pocket.name,
    pocketId: pocket.id,
    payer:
      state.members.find((member) => member.id === input.payerMemberId)
        ?.displayName ?? state.settings.memberName,
    amount: input.amount,
    currency: pocket.currency,
    kind,
    date: "Ahora",
    occurredAt: new Date().toISOString(),
  };
  financeData.update((current) => ({
    ...current,
    transactions: [transaction, ...current.transactions],
    pockets: current.pockets.map((item) =>
      item.id === pocket.id
        ? {
            ...item,
            currentAmount: Math.max(
              0,
              item.currentAmount +
                (kind === "expense" ? -input.amount : input.amount),
            ),
          }
        : item,
    ),
  }));
}

export async function updateTransaction(
  transactionId: string,
  input: { merchant: string; category: string },
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      transactions: state.transactions.map((transaction) =>
        transaction.id === transactionId
          ? { ...transaction, ...input }
          : transaction,
      ),
    }));
    return;
  }
  await apiRequest(`/v1/transactions/${transactionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  await hydrateFinanceData();
}

export async function allocateToPocket(
  pocketId: string,
  amount: number,
): Promise<void> {
  if (isServerMode()) {
    await apiRequest(`/v1/pockets/${pocketId}/allocate`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ amount: String(amount) }),
    });
    await hydrateFinanceData();
    return;
  }
  financeData.update((state) => ({
    ...state,
    pockets: state.pockets.map((pocket) =>
      pocket.id === pocketId
        ? { ...pocket, currentAmount: pocket.currentAmount + amount }
        : pocket,
    ),
  }));
}

export async function setPocketStatus(
  pocket: PocketView,
  status: "active" | "paused" | "completed" | "archived",
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      pockets:
        status === "archived"
          ? state.pockets.filter((item) => item.id !== pocket.id)
          : state.pockets.map((item) =>
              item.id === pocket.id ? { ...item, status } : item,
            ),
    }));
    return;
  }
  if (status === "archived") {
    await archivePocket(pocket, {
      ...(pocket.currentAmount > 0 ? { disposition: "release" as const } : {}),
    });
    return;
  } else {
    await apiRequest(`/v1/pockets/${pocket.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, version: pocket.version ?? 1 }),
    });
  }
  await hydrateFinanceData();
}

export async function createAccount(input: {
  name: string;
  type: string;
  currency: string;
  scope: "household" | "private";
  openingBalance?: number;
  openingBalanceDate?: string;
}): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      accounts: [
        {
          id: crypto.randomUUID(),
          name: input.name,
          type: input.type,
          currency: input.currency,
          currentBalance: input.openingBalance ?? 0,
          scope: input.scope,
        },
        ...state.accounts,
      ],
    }));
    return;
  }
  await apiRequest("/v1/accounts", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      openingBalance:
        input.openingBalance === undefined
          ? undefined
          : String(input.openingBalance),
    }),
  });
  await hydrateFinanceData();
}

export async function updateAccount(
  account: AccountView,
  input: { name?: string; currency?: string },
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      accounts: state.accounts.map((item) =>
        item.id === account.id ? { ...item, ...input } : item,
      ),
    }));
    return;
  }
  await apiRequest(`/v1/accounts/${account.scope}/${account.id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  await hydrateFinanceData();
}

export async function archiveAccount(account: AccountView): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      accounts: state.accounts.filter((item) => item.id !== account.id),
    }));
    return;
  }
  await apiRequest(`/v1/accounts/${account.scope}/${account.id}`, {
    method: "DELETE",
  });
  await hydrateFinanceData();
}

export async function createCategory(input: {
  name: string;
  icon: string;
  color: string;
}): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      categories: [{ id: crypto.randomUUID(), ...input }, ...state.categories],
    }));
    return;
  }
  await apiRequest("/v1/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
  await hydrateFinanceData();
}

export async function updateCategory(
  categoryId: string,
  input: { name: string; icon: string; color: string },
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      categories: state.categories.map((category) =>
        category.id === categoryId ? { ...category, ...input } : category,
      ),
    }));
    return;
  }
  await apiRequest(`/v1/categories/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  await hydrateFinanceData();
}

export async function archiveCategory(categoryId: string): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      categories: state.categories.filter(
        (category) => category.id !== categoryId,
      ),
    }));
    return;
  }
  await apiRequest(`/v1/categories/${categoryId}`, { method: "DELETE" });
  await hydrateFinanceData();
}

export async function updateProfile(input: {
  displayName: string;
  avatar?: string | null;
  color: string;
}): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      members: state.members.map((member) =>
        member.id === state.settings.memberId
          ? { ...member, ...input }
          : member,
      ),
      settings: {
        ...state.settings,
        memberName: input.displayName,
        memberAvatar: input.avatar,
        memberColor: input.color,
      },
    }));
    return;
  }
  await apiRequest("/v1/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  await hydrateFinanceData();
}

export async function updateHousehold(input: {
  name: string;
  baseCurrency: string;
}): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      settings: {
        ...state.settings,
        householdName: input.name,
        baseCurrency: input.baseCurrency,
      },
    }));
    return;
  }
  await apiRequest("/v1/household", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  await hydrateFinanceData();
}

export async function generateInsight(
  scope: "household" | "private",
): Promise<void> {
  if (!isServerMode()) {
    const state = get(financeData);
    const visiblePocketIds = new Set(
      state.pockets
        .filter((pocket) => pocket.visibility === scope)
        .map((pocket) => pocket.id),
    );
    const expenses = state.transactions.filter(
      (transaction) =>
        transaction.kind === "expense" &&
        (scope === "household"
          ? visiblePocketIds.has(transaction.pocketId)
          : visiblePocketIds.has(transaction.pocketId)),
    );
    const total = expenses.reduce(
      (sum, transaction) => sum + transaction.amount,
      0,
    );
    const evidence = expenses.slice(0, 5).map((transaction) => ({
      id: `transaction:${transaction.id}`,
      kind: "transaction",
      label: `${transaction.category} · ${transaction.merchant}`,
      value: String(transaction.amount),
    }));
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const periodEnd = now.toISOString().slice(0, 10);
    const insight: InsightView = {
      id: `local-insight-${Date.now()}`,
      scope,
      periodStart,
      periodEnd,
      createdAt: now.toISOString(),
      payload: {
        provider: "deterministic",
        model: "local-demo",
        generatedAt: now.toISOString(),
        title: scope === "household" ? "Lectura del hogar" : "Lectura personal",
        priority: "low",
        confidence: expenses.length > 0 ? 1 : null,
        evidence,
        bundle: {
          status: expenses.length > 0 ? "ok" : "insufficient_data",
          summary:
            expenses.length > 0
              ? `Se analizaron ${expenses.length} gastos por un total de ${total.toLocaleString("es-CO")} ${state.settings.baseCurrency}.`
              : "Todavía no hay gastos suficientes en este alcance para generar un análisis.",
          alerts: [],
          spendingFindings: [],
          opportunities: [],
          goals: [],
          news: [],
        },
      },
    };
    financeData.update((current) => ({
      ...current,
      insights: [insight, ...current.insights],
    }));
    return;
  }
  await apiRequest("/v1/insights/generate", {
    method: "POST",
    body: JSON.stringify({ scope }),
  });
  await hydrateFinanceData();
}

export async function loadChat(
  scope: "household" | "private",
): Promise<ChatMessageView[]> {
  if (!isServerMode()) return [];
  return apiRequest<ChatMessageView[]>(`/v1/ai-cfo/chat?scope=${scope}`);
}

export async function sendChatMessage(
  message: string,
  scope: "household" | "private",
): Promise<ChatMessageView> {
  if (!message.trim()) throw new Error("Escribe una pregunta");
  if (!isServerMode()) {
    return {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "El chat conversacional necesita el servicio AI-CFO. En la demostración local puedes usar “Generar análisis” para probar el motor determinístico.",
      createdAt: new Date().toISOString(),
      provider: "deterministic",
      model: "local-demo",
      citations: [],
    };
  }
  return apiRequest<ChatMessageView>("/v1/ai-cfo/chat", {
    method: "POST",
    body: JSON.stringify({ message: message.trim(), scope }),
  });
}

export async function clearChat(
  scope: "household" | "private",
): Promise<number> {
  if (!isServerMode()) return 0;
  const result = await apiRequest<{ removed: number }>(
    `/v1/ai-cfo/chat?scope=${scope}`,
    { method: "DELETE" },
  );
  return result.removed;
}

function localTimeBucket(
  expectedDate: string,
): ExpectedIncomeView["timeBucket"] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expected = new Date(`${expectedDate}T00:00:00`);
  const days = Math.floor((expected.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days <= 7) return "this_week";
  if (
    expected.getFullYear() === today.getFullYear() &&
    expected.getMonth() === today.getMonth()
  )
    return "this_month";
  if (days <= 90) return "next_90_days";
  return "future";
}

function localRecurringDates(
  startDate: string,
  endDate: string | undefined,
  recurrence: string,
): string[] {
  if (!endDate || recurrence === "once" || recurrence === "custom") {
    return [startDate];
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (end < start) throw new Error("La fecha final no puede ser anterior");
  const dates: string[] = [];
  for (let index = 0; index < 120; index += 1) {
    const current = new Date(start);
    if (recurrence === "weekly" || recurrence === "biweekly") {
      current.setUTCDate(
        current.getUTCDate() + index * (recurrence === "weekly" ? 7 : 14),
      );
    } else {
      const months =
        recurrence === "monthly"
          ? index
          : recurrence === "quarterly"
            ? index * 3
            : recurrence === "semiannual"
              ? index * 6
              : index * 12;
      const anchorDay = current.getUTCDate();
      current.setUTCDate(1);
      current.setUTCMonth(current.getUTCMonth() + months);
      const lastDay = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0),
      ).getUTCDate();
      current.setUTCDate(Math.min(anchorDay, lastDay));
    }
    if (current > end) break;
    dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

export async function createIncomeSource(input: {
  name: string;
  kind: string;
  visibility: "household" | "private";
  currency: string;
  recurrence: string;
  defaultAmount?: number;
  description?: string;
}): Promise<string> {
  if (isServerMode()) {
    const created = await apiRequest<Record<string, unknown>>(
      "/v1/planning/income-sources",
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          defaultAmount: input.defaultAmount
            ? String(input.defaultAmount)
            : undefined,
        }),
      },
    );
    await hydrateFinanceData();
    return String(created.id);
  }
  const source: IncomeSourceView = { id: crypto.randomUUID(), ...input };
  financeData.update((state) => ({
    ...state,
    incomeSources: [source, ...state.incomeSources],
  }));
  return source.id;
}

export async function updateIncomeSource(
  sourceId: string,
  input: Partial<{
    name: string;
    kind: string;
    visibility: "household" | "private";
    currency: string;
    recurrence: string;
    defaultAmount: number;
    description: string;
  }>,
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      incomeSources: state.incomeSources.map((source) =>
        source.id === sourceId
          ? { ...source, ...input, updatedAt: new Date().toISOString() }
          : source,
      ),
    }));
    return;
  }
  await apiRequest(`/v1/planning/income-sources/${sourceId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      defaultAmount:
        input.defaultAmount === undefined
          ? undefined
          : String(input.defaultAmount),
    }),
  });
  await hydrateFinanceData();
}

export async function archiveIncomeSource(sourceId: string): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      incomeSources: state.incomeSources.filter(
        (source) => source.id !== sourceId,
      ),
    }));
    return;
  }
  await apiRequest(`/v1/planning/income-sources/${sourceId}`, {
    method: "DELETE",
  });
  await hydrateFinanceData();
}

export async function createExpectedIncome(input: {
  sourceId: string;
  expectedDate: string;
  expectedAmount: number;
  probability: number;
  status: "planned" | "confirmed";
  reason: string;
  notes?: string;
  repeatUntil?: string;
}): Promise<string> {
  if (isServerMode()) {
    const created = await apiRequest<Record<string, unknown>>(
      "/v1/planning/expected-incomes",
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          expectedAmount: String(input.expectedAmount),
        }),
      },
    );
    await hydrateFinanceData();
    return String(created.id);
  }
  const state = get(financeData);
  const source = state.incomeSources.find((item) => item.id === input.sourceId);
  if (!source) throw new Error("Selecciona una fuente válida");
  const dates = localRecurringDates(
    input.expectedDate,
    input.repeatUntil,
    source.recurrence,
  );
  const incomes = dates
    .filter(
      (date) =>
        !state.expectedIncomes.some(
          (existing) =>
            existing.sourceId === source.id && existing.expectedDate === date,
        ),
    )
    .map((date): ExpectedIncomeView => ({
      id: crypto.randomUUID(),
      sourceId: source.id,
      sourceName: source.name,
      expectedDate: date,
      expectedAmount: input.expectedAmount,
      currency: source.currency,
      status: input.status,
      probability: input.probability,
      reason: input.reason,
      ...(input.notes ? { notes: input.notes } : {}),
      timeBucket: localTimeBucket(date),
    }));
  const income =
    incomes[0] ??
    state.expectedIncomes.find(
      (existing) =>
        existing.sourceId === source.id &&
        existing.expectedDate === input.expectedDate,
    );
  if (!income) throw new Error("No se pudo generar el ingreso esperado");
  financeData.update((current) => ({
    ...current,
    expectedIncomes: [...current.expectedIncomes, ...incomes].sort(
      (left, right) => left.expectedDate.localeCompare(right.expectedDate),
    ),
  }));
  return income.id;
}

export async function updateExpectedIncome(
  incomeId: string,
  input: Partial<{
    sourceId: string;
    expectedDate: string;
    expectedAmount: number;
    probability: number;
    status: ExpectedIncomeView["status"];
    actualAmount: number | null;
    reason: string;
    notes: string;
  }>,
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      expectedIncomes: state.expectedIncomes.map((income) =>
        income.id === incomeId
          ? {
              ...income,
              ...input,
              actualAmount:
                input.actualAmount === null
                  ? undefined
                  : (input.actualAmount ?? income.actualAmount),
              timeBucket: input.expectedDate
                ? localTimeBucket(input.expectedDate)
                : income.timeBucket,
              updatedAt: new Date().toISOString(),
            }
          : income,
      ),
    }));
    return;
  }
  await apiRequest(`/v1/planning/expected-incomes/${incomeId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      expectedAmount:
        input.expectedAmount === undefined
          ? undefined
          : String(input.expectedAmount),
      actualAmount:
        input.actualAmount === undefined
          ? undefined
          : input.actualAmount === null
            ? null
            : String(input.actualAmount),
    }),
  });
  await hydrateFinanceData();
}

export async function cancelExpectedIncome(incomeId: string): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      expectedIncomes: state.expectedIncomes.map((income) =>
        income.id === incomeId
          ? {
              ...income,
              status: "cancelled",
              updatedAt: new Date().toISOString(),
            }
          : income,
      ),
    }));
    return;
  }
  await apiRequest(`/v1/planning/expected-incomes/${incomeId}`, {
    method: "DELETE",
  });
  await hydrateFinanceData();
}

export async function createFundingPlan(input: {
  title: string;
  purpose: string;
  horizon: FundingPlanView["horizon"];
  visibility: "household" | "private";
  currency: string;
  status: "draft" | "agreed" | "active";
  startDate: string;
  targetDate?: string;
  decisionNote: string;
  allocations: Array<{
    expectedIncomeId: string;
    pocketId?: string;
    paymentPlanId?: string;
    mode: "fixed" | "percentage" | "remainder";
    value?: number;
    priority: number;
    rationale: string;
  }>;
}): Promise<string> {
  if (isServerMode()) {
    const created = await apiRequest<Record<string, unknown>>(
      "/v1/planning/plans",
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          allocations: input.allocations.map((allocation) => ({
            ...allocation,
            value:
              allocation.value === undefined
                ? undefined
                : String(allocation.value),
          })),
        }),
      },
    );
    await hydrateFinanceData();
    return String(created.id);
  }
  const state = get(financeData);
  if (
    input.allocations.some((allocation) =>
      state.fundingPlans.some((plan) =>
        plan.allocations.some(
          (existing) =>
            existing.expectedIncomeId === allocation.expectedIncomeId,
        ),
      ),
    )
  ) {
    throw new Error(
      "Este ingreso ya tiene un plan; registra una revisión del acuerdo existente",
    );
  }
  const incomeGroups = new Map<string, typeof input.allocations>();
  for (const allocation of input.allocations) {
    incomeGroups.set(allocation.expectedIncomeId, [
      ...(incomeGroups.get(allocation.expectedIncomeId) ?? []),
      allocation,
    ]);
  }
  for (const [incomeId, allocations] of incomeGroups) {
    const income = state.expectedIncomes.find((item) => item.id === incomeId);
    const source = state.incomeSources.find(
      (item) => item.id === income?.sourceId,
    );
    if (!income || !source || source.visibility !== input.visibility) {
      throw new Error("La fuente no pertenece al alcance del plan");
    }
    let assigned = 0;
    let remainderRules = 0;
    for (const allocation of [...allocations].sort(
      (left, right) => left.priority - right.priority,
    )) {
      const pocket = allocation.pocketId
        ? state.pockets.find((item) => item.id === allocation.pocketId)
        : undefined;
      if (
        allocation.pocketId &&
        (!pocket ||
          pocket.visibility !== input.visibility ||
          pocket.currency !== input.currency)
      ) {
        throw new Error(
          "Cada bolsillo debe tener el mismo alcance y moneda del plan",
        );
      }
      if (allocation.mode === "fixed") assigned += allocation.value ?? 0;
      if (allocation.mode === "percentage") {
        const ratio = allocation.value ?? 0;
        if (ratio < 0 || ratio > 1)
          throw new Error("El porcentaje no es válido");
        assigned += income.expectedAmount * ratio;
      }
      if (allocation.mode === "remainder") remainderRules += 1;
    }
    if (remainderRules > 1)
      throw new Error("Solo puede existir un remanente por ingreso");
    if (assigned > income.expectedAmount) {
      throw new Error("Las asignaciones superan el ingreso esperado");
    }
  }
  const plan: FundingPlanView = {
    id: crypto.randomUUID(),
    title: input.title,
    purpose: input.purpose,
    horizon: input.horizon,
    visibility: input.visibility,
    currency: input.currency,
    status: input.status,
    startDate: input.startDate,
    ...(input.targetDate ? { targetDate: input.targetDate } : {}),
    version: 1,
    allocations: input.allocations.map((allocation) => {
      const income = state.expectedIncomes.find(
        (item) => item.id === allocation.expectedIncomeId,
      );
      const pocket = allocation.pocketId
        ? state.pockets.find((item) => item.id === allocation.pocketId)
        : undefined;
      if (!income || (allocation.pocketId && !pocket))
        throw new Error("La fuente o el destino ya no existe");
      return {
        ...allocation,
        sourceName: income.sourceName,
        pocketName: pocket?.name ?? "Pago programado",
      };
    }),
    revisions: [
      {
        version: 1,
        decisionNote: input.decisionNote,
        createdAt: new Date().toISOString(),
        actorName: state.settings.memberName,
      },
    ],
  };
  financeData.update((current) => ({
    ...current,
    fundingPlans: [plan, ...current.fundingPlans],
  }));
  return plan.id;
}

export async function loadPlanHistory(
  planId: string,
): Promise<PlanRevisionView[]> {
  if (!isServerMode()) {
    return (
      get(financeData).fundingPlans.find((plan) => plan.id === planId)
        ?.revisions ?? []
    );
  }
  const revisions = await apiRequest<Record<string, unknown>[]>(
    `/v1/planning/plans/${planId}/history`,
  );
  const mapped = revisions.map((revision) => {
    const actor = revision.actor as Record<string, unknown> | undefined;
    return {
      version: Number(revision.version),
      decisionNote: String(revision.decisionNote),
      createdAt: String(revision.createdAt),
      ...(actor?.displayName ? { actorName: String(actor.displayName) } : {}),
    };
  });
  financeData.update((state) => ({
    ...state,
    fundingPlans: state.fundingPlans.map((plan) =>
      plan.id === planId ? { ...plan, revisions: mapped } : plan,
    ),
  }));
  return mapped;
}

export async function recordPlanReview(
  planId: string,
  decisionNote: string,
  status?: "draft" | "agreed" | "active",
): Promise<void> {
  if (!decisionNote.trim()) throw new Error("Explica qué se revisó o decidió");
  if (isServerMode()) {
    await apiRequest(`/v1/planning/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify({
        decisionNote: decisionNote.trim(),
        ...(status ? { status } : {}),
      }),
    });
    await hydrateFinanceData();
    await loadPlanHistory(planId);
    return;
  }
  financeData.update((state) => ({
    ...state,
    fundingPlans: state.fundingPlans.map((plan) =>
      plan.id === planId
        ? {
            ...plan,
            version: plan.version + 1,
            ...(status ? { status } : {}),
            revisions: [
              {
                version: plan.version + 1,
                decisionNote: decisionNote.trim(),
                createdAt: new Date().toISOString(),
                actorName: state.settings.memberName,
              },
              ...plan.revisions,
            ],
          }
        : plan,
    ),
  }));
}

export async function updateFundingPlan(
  planId: string,
  input: {
    title: string;
    purpose: string;
    horizon: FundingPlanView["horizon"];
    status: FundingPlanView["status"];
    targetDate?: string;
    decisionNote: string;
    allocations?: Array<{
      expectedIncomeId: string;
      pocketId?: string;
      paymentPlanId?: string;
      mode: "fixed" | "percentage" | "remainder";
      value?: number;
      priority: number;
      rationale: string;
    }>;
  },
): Promise<void> {
  if (isServerMode()) {
    await apiRequest(`/v1/planning/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...input,
        ...(input.allocations
          ? {
              allocations: input.allocations.map((allocation) => ({
                ...allocation,
                value:
                  allocation.value === undefined
                    ? undefined
                    : String(allocation.value),
              })),
            }
          : {}),
      }),
    });
    await hydrateFinanceData();
    return;
  }
  const currentState = get(financeData);
  const normalizedAllocations = input.allocations?.map((allocation) => {
    const pocket = allocation.pocketId
      ? currentState.pockets.find((item) => item.id === allocation.pocketId)
      : undefined;
    const income = currentState.expectedIncomes.find(
      (item) => item.id === allocation.expectedIncomeId,
    );
    return {
      ...allocation,
      id: crypto.randomUUID(),
      pocketName: pocket?.name ?? "Destino",
      sourceName: income?.sourceName ?? "Ingreso",
      status: "planned" as const,
      executedAmount: 0,
    };
  });
  const planFields = {
    title: input.title,
    purpose: input.purpose,
    horizon: input.horizon,
    status: input.status,
    ...(input.targetDate ? { targetDate: input.targetDate } : {}),
    decisionNote: input.decisionNote,
  };
  financeData.update((state) => ({
    ...state,
    fundingPlans: state.fundingPlans.map((plan) =>
      plan.id === planId
        ? {
            ...plan,
            ...planFields,
            ...(normalizedAllocations
              ? { allocations: normalizedAllocations }
              : {}),
            version: plan.version + 1,
            revisions: [
              {
                version: plan.version + 1,
                decisionNote: input.decisionNote,
                createdAt: new Date().toISOString(),
                actorName: state.settings.memberName,
              },
              ...plan.revisions,
            ],
          }
        : plan,
    ),
  }));
}

export async function archiveFundingPlan(planId: string): Promise<void> {
  if (isServerMode()) {
    await apiRequest(`/v1/planning/plans/${planId}`, { method: "DELETE" });
    await hydrateFinanceData();
    return;
  }
  financeData.update((state) => ({
    ...state,
    fundingPlans: state.fundingPlans.filter((plan) => plan.id !== planId),
  }));
}

export async function executePlanAllocation(
  allocationId: string,
  amount: number,
): Promise<void> {
  if (!isServerMode()) {
    financeData.update((state) => ({
      ...state,
      fundingPlans: state.fundingPlans.map((plan) => ({
        ...plan,
        allocations: plan.allocations.map((allocation) =>
          allocation.id === allocationId
            ? {
                ...allocation,
                executedAmount: (allocation.executedAmount ?? 0) + amount,
                status: "partial",
              }
            : allocation,
        ),
      })),
      pockets: state.pockets.map((pocket) => {
        const allocation = state.fundingPlans
          .flatMap((plan) => plan.allocations)
          .find((item) => item.id === allocationId);
        return allocation?.pocketId === pocket.id
          ? { ...pocket, currentAmount: pocket.currentAmount + amount }
          : pocket;
      }),
    }));
    return;
  }
  await apiRequest(`/v1/planning/allocations/${allocationId}/execute`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ amount: String(amount) }),
  });
  await hydrateFinanceData();
}

export function exportFinanceData(): string {
  return JSON.stringify(get(financeData), null, 2);
}

export async function importFinanceData(raw: string): Promise<void> {
  const parsed = JSON.parse(raw) as Omit<
    Partial<FinanceState>,
    "schemaVersion"
  > & {
    schemaVersion?: number;
  };
  if (
    ![1, 2, 3].includes(parsed.schemaVersion ?? 0) ||
    !Array.isArray(parsed.pockets) ||
    !Array.isArray(parsed.transactions)
  ) {
    throw new Error("El archivo no pertenece a OKLE o usa otra versión");
  }
  if (isServerMode()) {
    const pocketIds = new Map<string, string>();
    for (const pocket of parsed.pockets) {
      const createdId = await createPocket({
        name: pocket.name,
        purpose: pocket.purpose,
        visibility: pocket.visibility,
        currency: pocket.currency,
        targetAmount: pocket.targetAmount,
        policyKind: pocket.policyKind ?? "target_by_contribution",
        targetDate: pocket.targetDate,
        monthlyContribution:
          pocket.monthlyContribution ?? Math.max(1, pocket.targetAmount / 12),
      });
      pocketIds.set(pocket.id, createdId);
      if (pocket.currentAmount > 0) {
        await allocateToPocket(createdId, pocket.currentAmount);
      }
    }
    const sourceIds = new Map<string, string>();
    for (const source of parsed.incomeSources ?? []) {
      const createdId = await createIncomeSource({
        name: source.name,
        kind: source.kind,
        visibility: source.visibility,
        currency: source.currency,
        recurrence: source.recurrence,
        ...(source.defaultAmount !== undefined
          ? { defaultAmount: source.defaultAmount }
          : {}),
        ...(source.description ? { description: source.description } : {}),
      });
      sourceIds.set(source.id, createdId);
    }
    const incomeIds = new Map<string, string>();
    for (const income of parsed.expectedIncomes ?? []) {
      const sourceId = sourceIds.get(income.sourceId);
      if (!sourceId) continue;
      const createdId = await createExpectedIncome({
        sourceId,
        expectedDate: income.expectedDate,
        expectedAmount: income.expectedAmount,
        probability: income.probability,
        status: income.status === "confirmed" ? "confirmed" : "planned",
        reason: income.reason,
        ...(income.notes ? { notes: income.notes } : {}),
      });
      incomeIds.set(income.id, createdId);
    }
    for (const plan of parsed.fundingPlans ?? []) {
      const allocations = plan.allocations.flatMap((allocation) => {
        const expectedIncomeId = incomeIds.get(allocation.expectedIncomeId);
        const pocketId = allocation.pocketId
          ? pocketIds.get(allocation.pocketId)
          : undefined;
        if (!expectedIncomeId || !pocketId) return [];
        return [
          {
            expectedIncomeId,
            pocketId,
            mode: allocation.mode,
            ...(allocation.value !== undefined
              ? { value: allocation.value }
              : {}),
            priority: allocation.priority,
            rationale: allocation.rationale,
          },
        ];
      });
      if (allocations.length === 0) continue;
      const orderedRevisions = [...plan.revisions].sort(
        (left, right) => left.version - right.version,
      );
      const createdPlanId = await createFundingPlan({
        title: plan.title,
        purpose: plan.purpose,
        horizon: plan.horizon,
        visibility: plan.visibility,
        currency: plan.currency,
        status:
          plan.status === "agreed" || plan.status === "active"
            ? plan.status
            : "draft",
        startDate: plan.startDate,
        ...(plan.targetDate ? { targetDate: plan.targetDate } : {}),
        decisionNote:
          orderedRevisions[0]?.decisionNote ??
          "Plan importado desde el respaldo local.",
        allocations,
      });
      for (const revision of orderedRevisions.slice(1)) {
        await recordPlanReview(createdPlanId, revision.decisionNote);
      }
    }
    return;
  }
  financeData.set({
    ...initial,
    ...parsed,
    schemaVersion: 3,
    pockets: parsed.pockets,
    transactions: parsed.transactions,
    accounts: parsed.accounts ?? initial.accounts,
    accountConnections: parsed.accountConnections ?? initial.accountConnections,
    members: parsed.members ?? initial.members,
    insights: parsed.insights ?? initial.insights,
    aiStatus: parsed.aiStatus ?? initial.aiStatus,
    incomeSources: parsed.incomeSources ?? [],
    expectedIncomes: parsed.expectedIncomes ?? [],
    fundingPlans: parsed.fundingPlans ?? [],
  });
}

export function resetLocalData(): void {
  if (isServerMode())
    throw new Error("El reinicio solo está disponible en modo local");
  financeData.set(structuredClone(initial));
}
