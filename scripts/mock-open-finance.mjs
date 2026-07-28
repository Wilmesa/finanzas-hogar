import { createHmac } from "node:crypto";

const secret = process.env.OPEN_FINANCE_MOCK_SECRET;
const sourceAccountId = process.env.MOCK_SOURCE_ACCOUNT_ID;
const apiBase = process.env.OKLE_API_BASE_URL ?? "http://127.0.0.1:3100/api";
const phase = process.argv[2] ?? "both";
const allowedPhases = ["pending", "posted", "both"];

if (!secret || secret.length < 32)
  throw new Error("OPEN_FINANCE_MOCK_SECRET debe tener al menos 32 caracteres");
if (!sourceAccountId) throw new Error("MOCK_SOURCE_ACCOUNT_ID es obligatorio");
if (!allowedPhases.includes(phase))
  throw new Error("La fase debe ser pending, posted o both");
if (
  !process.env.OKLE_AUTHORIZATION &&
  !(process.env.OKLE_SESSION_COOKIE && process.env.OKLE_CSRF_TOKEN)
) {
  throw new Error(
    "Configura OKLE_AUTHORIZATION o la pareja OKLE_SESSION_COOKIE/OKLE_CSRF_TOKEN",
  );
}

const now = new Date();
const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(now);
const batchId = process.env.MOCK_BATCH_ID ?? `daily-${localDate}`;
const occurredAt = process.env.MOCK_OCCURRED_AT ?? `${localDate}T13:00:00.000Z`;

async function send(currentPhase) {
  const payload = {
    batchId,
    phase: currentPhase,
    transactions: [
      {
        logicalId: "daily-coffee",
        type: "withdrawal",
        amount: process.env.MOCK_AMOUNT ?? "12500",
        currency: "COP",
        merchant: process.env.MOCK_MERCHANT ?? "Café Sandbox Bogotá",
        occurredAt,
        sourceAccountId,
      },
    ],
  };
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetch(`${apiBase}/v1/ingestion/mock-sandbox`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-OKLE-Open-Finance-Signature": signature,
      ...(process.env.OKLE_AUTHORIZATION
        ? { Authorization: process.env.OKLE_AUTHORIZATION }
        : {}),
      ...(process.env.OKLE_SESSION_COOKIE
        ? { Cookie: process.env.OKLE_SESSION_COOKIE }
        : {}),
      ...(process.env.OKLE_CSRF_TOKEN
        ? { "X-CSRF-Token": process.env.OKLE_CSRF_TOKEN }
        : {}),
    },
    body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${currentPhase} respondió HTTP ${response.status}: ${JSON.stringify(result)}`,
    );
  }
  console.log(
    `${currentPhase}: ${result.received} movimiento(s), Firefly=${result.results?.[0]?.fireflyCreated ?? "replay"}`,
  );
}

if (phase === "both") {
  await send("pending");
  await send("posted");
} else {
  await send(phase);
}
