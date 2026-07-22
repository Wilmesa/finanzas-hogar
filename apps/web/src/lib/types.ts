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
  version?: number;
  status?: "active" | "paused" | "completed" | "archived";
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

export interface AccountConnectionView {
  scope: "household" | "private";
  configured: boolean;
  status: "available" | "unavailable";
  message?: string;
}

export interface MemberView {
  id: string;
  displayName: string;
  email: string;
  username?: string | null;
  role: "owner" | "member";
  avatar?: string | null;
  color: string;
}

export interface AiStatusView {
  status: string;
  provider: string;
  providerName?: string;
  model: string | null;
  keyPresent: boolean;
  generationEnabled: boolean;
}

export interface CategoryView {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  provider?: string | null;
  model?: string | null;
  citations?: Array<{ title: string; url: string }>;
}

export interface InsightView {
  id: string;
  scope: "household" | "private";
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  payload: {
    provider?: string;
    model?: string | null;
    generatedAt?: string;
    title?: string;
    estimatedImpact?: string | null;
    priority?: "low" | "medium" | "high";
    confidence?: number | null;
    suggestedAction?: string | null;
    evidence?: Array<{
      id: string;
      kind: string;
      label: string;
      value: string;
    }>;
    bundle?: {
      status: "ok" | "insufficient_data";
      summary: string;
      alerts: Array<{
        severity: string;
        message: string;
        evidenceIds: string[];
      }>;
      spendingFindings: Array<{
        title: string;
        amount: string;
        comparison: string;
        evidenceIds: string[];
      }>;
      opportunities: Array<{
        action: string;
        estimatedMonthlyImpact: string;
        confidence: number;
        evidenceIds: string[];
      }>;
      goals: Array<{ pocketId: string; status: string; explanation: string }>;
      news: Array<{
        sourceUrl: string;
        publishedAt: string;
        factSummary: string;
        possibleImpact: string;
      }>;
    };
  };
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
  updatedAt?: string;
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
  updatedAt?: string;
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
  updatedAt?: string;
}

export interface FinanceState {
  schemaVersion: 3;
  pockets: PocketView[];
  transactions: TransactionView[];
  accounts: AccountView[];
  accountConnections: AccountConnectionView[];
  members: MemberView[];
  insights: InsightView[];
  categories: CategoryView[];
  aiStatus: AiStatusView;
  incomeSources: IncomeSourceView[];
  expectedIncomes: ExpectedIncomeView[];
  fundingPlans: FundingPlanView[];
  settings: {
    memberName: string;
    memberId: string;
    memberEmail: string;
    memberRole: "owner" | "member";
    memberAvatar?: string | null;
    memberColor: string;
    householdName: string;
    baseCurrency: string;
    dailyReminder: string;
  };
}
