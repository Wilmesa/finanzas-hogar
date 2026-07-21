from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class Period(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: str
    end: str
    daysRemaining: int = Field(ge=0)


class Metrics(BaseModel):
    model_config = ConfigDict(extra="forbid")
    income: str
    spent: str
    savingsRate: float
    safeDailySpend: str


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: str
    label: str
    value: str


class NewsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceUrl: HttpUrl
    publishedAt: str
    title: str
    summary: str


class InsightSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: Literal["household", "private"]
    period: Period
    currency: str
    metrics: Metrics
    pockets: list[dict] = Field(default_factory=list)
    spendingBreakdown: list[dict] = Field(default_factory=list)
    recurringPatterns: list[dict] = Field(default_factory=list)
    anomalies: list[dict] = Field(default_factory=list)
    forecast: dict = Field(default_factory=dict)
    evidence: list[Evidence] = Field(default_factory=list)
    news: list[NewsInput] = Field(default_factory=list)


class Alert(BaseModel):
    model_config = ConfigDict(extra="forbid")
    severity: Literal["info", "warning", "critical"]
    message: str
    evidenceIds: list[str]


class SpendingFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    amount: str
    comparison: str
    evidenceIds: list[str]


class Opportunity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    estimatedMonthlyImpact: str
    confidence: float = Field(ge=0, le=1)
    evidenceIds: list[str]


class GoalInsight(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pocketId: str
    status: str
    explanation: str


class NewsInsight(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceUrl: HttpUrl
    publishedAt: str
    factSummary: str
    possibleImpact: str


class InsightBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["ok", "insufficient_data"]
    summary: str
    alerts: list[Alert]
    spendingFindings: list[SpendingFinding]
    opportunities: list[Opportunity]
    goals: list[GoalInsight]
    news: list[NewsInsight]

