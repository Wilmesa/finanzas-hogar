import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

// Run ONLY against the disposable smoke project, never against a user's ledger.
assert.match(process.env.COMPOSE_PROJECT_NAME ?? "", /^finanzas-smoke-/);
const base = `http://127.0.0.1:${process.env.SMOKE_LOCAL_PORT ?? 13100}/api/v1`;
async function login(identifier, password) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  assert.equal(response.status, 201, "login");
  const body = await response.json();
  return {
    Cookie: response.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": body.csrfToken,
  };
}
const a = await login("smoke-a", process.env.MEMBER_A_BOOTSTRAP_PASSWORD);
const b = await login("smoke-b", process.env.MEMBER_B_BOOTSTRAP_PASSWORD);
async function api(
  path,
  body,
  member = a,
  method = body ? "POST" : "GET",
  key = randomUUID(),
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...member,
      "Idempotency-Key": key,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.ok(
    response.ok,
    `${method} ${path}: ${response.status} ${JSON.stringify(result)}`,
  );
  return result;
}
async function account(name, member, owner) {
  return api(
    "/accounts",
    {
      name,
      type: "checking",
      currency: "COP",
      scope: "household",
      ownerMemberId: owner,
      openingBalance: "0",
      openingBalanceDate: new Date().toISOString().slice(0, 10),
    },
    member,
  );
}
const accountA = await account("Nómina A smoke", a, "smoke-member-a");
const accountB = await account("Nómina B smoke", b, "smoke-member-b");
const income = {
  type: "deposit",
  amount: "1000000",
  currency: "COP",
  description: "Salario smoke",
  destinationId: accountA.id,
  occurredAt: new Date().toISOString(),
};
const key = randomUUID();
const received = await api("/transactions", income, a, "POST", key);
assert.equal(received.syncStatus, "synchronized");
// Simulate process death after Firefly accepted the deposit but before OKLE
// retained its acknowledgement. This database is guarded as disposable above.
assert.match(received.id, /^[a-zA-Z0-9-]+$/);
execFileSync(
  "scripts/compose.sh",
  [
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "finanzas",
    "-d",
    "finanzas",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `UPDATE "TransactionAttribution" SET "syncStatus"='processing', "fireflyTransactionId"=NULL, "lastSyncAttemptAt"=NOW()-INTERVAL '5 minutes' WHERE id='${received.id}'`,
  ],
  { stdio: "pipe" },
);
assert.equal(
  (await api("/transactions/reconcile", undefined, a, "POST")).recovered,
  1,
  "recovers the existing Firefly deposit without re-posting it",
);
assert.equal(
  (await api("/transactions", income, a, "POST", key)).id,
  received.id,
);
const pocket = await api("/pockets", {
  name: "Ahorro smoke",
  currency: "COP",
  policy: {
    kind: "target_by_contribution",
    targetAmount: "1000000",
    contributionAmount: "100000",
    frequency: "monthly",
  },
});
const reserveKey = randomUUID();
const reservation = {
  amount: "300000",
  sourceAccountId: accountA.id,
  sourceLedgerScope: "household",
};
await api(`/pockets/${pocket.id}/allocate`, reservation, a, "POST", reserveKey);
await api(`/pockets/${pocket.id}/allocate`, reservation, a, "POST", reserveKey);
let accounts = await api("/accounts");
let balance = accounts.accounts.find((item) => item.id === accountA.id);
assert.equal(Number(balance.currentBalance), 1000000);
assert.equal(Number(balance.reservedAmount), 300000);
assert.equal(Number(balance.availableBalance), 700000);
const denied = await fetch(`${base}/pockets/${pocket.id}/allocate`, {
  method: "POST",
  headers: {
    ...b,
    "Content-Type": "application/json",
    "Idempotency-Key": randomUUID(),
  },
  body: JSON.stringify({
    amount: "1",
    sourceAccountId: accountA.id,
    sourceLedgerScope: "household",
  }),
});
assert.equal(denied.status, 404, "partner cannot dispose of creator's pocket");
await api(
  "/transactions",
  {
    type: "withdrawal",
    amount: "100000",
    currency: "COP",
    description: "Mercado smoke",
    sourceId: accountA.id,
    occurredAt: new Date().toISOString(),
  },
  b,
);
await api(`/pockets/${pocket.id}/release`, {
  amount: "50000",
  targetAccountId: accountA.id,
  targetLedgerScope: "household",
});
await api("/transactions", {
  type: "transfer",
  amount: "50000",
  currency: "COP",
  description: "Transferencia smoke",
  sourceId: accountA.id,
  destinationId: accountB.id,
  occurredAt: new Date().toISOString(),
});
accounts = await api("/accounts");
balance = accounts.accounts.find((item) => item.id === accountA.id);
assert.equal(Number(balance.currentBalance), 850000);
assert.equal(Number(balance.reservedAmount), 250000);
assert.equal(Number(balance.availableBalance), 600000);
assert.equal(
  Number(
    accounts.accounts.find((item) => item.id === accountB.id).currentBalance,
  ),
  50000,
);
await api(
  `/accounts/household/${accountA.id}`,
  { color: "#112233" },
  a,
  "PATCH",
);
const source = await api("/planning/income-sources", {
  name: "Salario planeado smoke",
  kind: "salary",
  currency: "COP",
});
const today = new Date().toISOString().slice(0, 10);
const expected = await api("/planning/expected-incomes", {
  sourceId: source.id,
  expectedDate: today,
  expectedAmount: "1000000",
  reason: "Salario del mes",
});
await api(`/planning/expected-incomes/${expected.id}/receive`, {
  attributionId: received.id,
  actualAmount: "1000000",
});
const plan = await api("/planning/plans", {
  title: "Acuerdo smoke",
  purpose: "Reserva pactada",
  horizon: "monthly",
  currency: "COP",
  startDate: today,
  decisionNote: "Acordamos reservar parte del salario",
  allocations: [
    {
      expectedIncomeId: expected.id,
      pocketId: pocket.id,
      mode: "fixed",
      value: "100000",
      priority: 1,
      rationale: "Ahorro acordado",
    },
  ],
});
await api(`/planning/plans/${plan.id}/execute`, {
  expectedIncomeId: expected.id,
});
await api(`/planning/plans/${plan.id}/execute`, {
  expectedIncomeId: expected.id,
});
balance = (await api("/accounts")).accounts.find(
  (item) => item.id === accountA.id,
);
assert.equal(
  Number(balance.reservedAmount),
  350000,
  "a repeated plan with a new request key must not reserve twice",
);
const allocateConcurrently = () =>
  fetch(`${base}/pockets/${pocket.id}/allocate`, {
    method: "POST",
    headers: {
      ...a,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      amount: "400000",
      sourceAccountId: accountA.id,
      sourceLedgerScope: "household",
    }),
  });
const attempts = await Promise.all([
  allocateConcurrently(),
  allocateConcurrently(),
]);
assert.deepEqual(
  attempts.map((response) => response.status).sort(),
  [201, 400],
  "only one competing reservation fits the available balance",
);
assert.equal(
  Number(
    (await api("/accounts")).accounts.find((item) => item.id === accountA.id)
      .reservedAmount,
  ),
  750000,
);
const secret = await api("/transactions", {
  type: "withdrawal",
  amount: "1000",
  currency: "COP",
  sourceId: accountA.id,
  occurredAt: new Date().toISOString(),
  description: "Regalo secreto smoke",
  category: "Sorpresa secreta",
  privacy: "private",
  fundingSourceScope: "household",
});
const partnerHistory = await api("/transactions", undefined, b);
assert.ok(!JSON.stringify(partnerHistory).includes("Regalo secreto"));
assert.ok(!JSON.stringify(partnerHistory).includes("Sorpresa secreta"));
assert.ok(
  partnerHistory.some((item) => item.merchant === "Asignación personal"),
);
await api(`/transactions/${secret.id}/reverse`, undefined, a, "POST");
assert.equal(
  Number(
    (await api("/accounts")).accounts.find((item) => item.id === accountA.id)
      .currentBalance,
  ),
  850000,
  "reversing private spending restores the shared account once",
);
console.log(
  "Privacidad real correcta: detalle oculto a la pareja, importe conciliable y reversión sin duplicar dinero.",
);
console.log(
  "Flujo financiero real correcto: dos usuarios, cuentas, ingreso idempotente, reserva, propiedad, gasto de pareja, liberación y transferencia; saldos conciliados.",
);
console.log(
  "Planes repetidos no duplican reservas; aportes concurrentes no sobreasignan la cuenta.",
);
