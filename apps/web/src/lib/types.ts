export interface PocketView {
  id: string;
  name: string;
  purpose: string;
  visibility: "household" | "private";
  currency: string;
  currentAmount: number;
  targetAmount: number;
  color: string;
  note: string;
  policyKind?: "target_by_date" | "target_by_contribution" | "periodic_spend";
  targetDate?: string;
  monthlyContribution?: number;
}

export interface TransactionView {
  id: string;
  merchant: string;
  category: string;
  pocket: string;
  payer: string;
  amount: number;
  date: string;
  occurredAt: string;
  pocketId: string;
  currency: string;
  kind: "expense" | "income" | "allocation";
}

export interface AccountView {
  id: string;
  name: string;
  type: string;
  currency: string;
  currentBalance: number;
  scope: "household" | "private";
}

export interface IncomeSourceView {
  id: string;
  name: string;
  kind: string;
  visibility: "household" | "private";
  currency: string;
  recurrence: string;
  defaultAmount?: number;
  description?: string;
}

export interface ExpectedIncomeView {
  id: string;
  sourceId: string;
  sourceName: string;
  expectedDate: string;
  expectedAmount: number;
  actualAmount?: number;
  currency: string;
  status: "planned" | "confirmed" | "received" | "cancelled";
  probability: number;
  reason: string;
  notes?: string;
  timeBucket: "today" | "this_week" | "this_month" | "next_90_days" | "future";
}

export interface PlanAllocationView {
  expectedIncomeId: string;
  pocketId: string;
  pocketName: string;
  sourceName: string;
  mode: "fixed" | "percentage" | "remainder";
  value?: number;
  priority: number;
  rationale: string;
}

export interface PlanRevisionView {
  version: number;
  decisionNote: string;
  createdAt: string;
  actorName?: string;
}

export interface FundingPlanView {
  id: string;
  title: string;
  purpose: string;
  horizon: "daily" | "weekly" | "monthly" | "short_term" | "long_term";
  visibility: "household" | "private";
  currency: string;
  status: "draft" | "agreed" | "active" | "completed" | "archived";
  startDate: string;
  targetDate?: string;
  version: number;
  allocations: PlanAllocationView[];
  revisions: PlanRevisionView[];
}

export interface FinanceState {
  schemaVersion: 2;
  pockets: PocketView[];
  transactions: TransactionView[];
  accounts: AccountView[];
  incomeSources: IncomeSourceView[];
  expectedIncomes: ExpectedIncomeView[];
  fundingPlans: FundingPlanView[];
  settings: {
    memberName: string;
    householdName: string;
    baseCurrency: string;
    dailyReminder: string;
  };
}
