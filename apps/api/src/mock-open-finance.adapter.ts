import { BadRequestException, Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  ImportedTransactionInput,
  IOpenFinanceProvider,
} from "./ingestion.service.js";

const mockPayloadSchema = z.object({
  batchId: z.string().trim().min(1).max(120),
  phase: z.enum(["pending", "posted"]),
  transactions: z
    .array(
      z.object({
        logicalId: z.string().trim().min(1).max(120),
        type: z.enum(["withdrawal", "deposit", "transfer"]),
        amount: z.string().refine((value) => Number(value) > 0),
        currency: z.string().length(3),
        merchant: z.string().trim().min(1).max(255),
        occurredAt: z.iso.datetime(),
        sourceAccountId: z.string().min(1).optional(),
        destinationAccountId: z.string().min(1).optional(),
        payerMemberId: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .max(100),
});

@Injectable()
export class MockOpenFinanceAdapter implements IOpenFinanceProvider {
  readonly name = "mock-sandbox";

  verifyWebhook(headers: Record<string, string>, rawBody: string) {
    if (process.env.OPEN_FINANCE_MOCK_ENABLED !== "true") return false;
    const secret = process.env.OPEN_FINANCE_MOCK_SECRET;
    const received = headers["x-okle-open-finance-signature"];
    if (!secret || secret.length < 32 || !received) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(received, "utf8");
    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  }

  async normalize(payload: unknown): Promise<ImportedTransactionInput[]> {
    const parsed = mockPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return parsed.data.transactions.map((transaction) => ({
      provider: this.name,
      externalId: `${parsed.data.batchId}:${transaction.logicalId}:${parsed.data.phase}`,
      status: parsed.data.phase,
      type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency.toUpperCase(),
      merchant: transaction.merchant,
      occurredAt: transaction.occurredAt,
      ...(transaction.sourceAccountId
        ? { sourceAccountId: transaction.sourceAccountId }
        : {}),
      ...(transaction.destinationAccountId
        ? { destinationAccountId: transaction.destinationAccountId }
        : {}),
      ...(transaction.payerMemberId
        ? { payerMemberId: transaction.payerMemberId }
        : {}),
    }));
  }

  sign(payload: unknown) {
    const secret = process.env.OPEN_FINANCE_MOCK_SECRET;
    if (!secret || secret.length < 32) {
      throw new BadRequestException(
        "OPEN_FINANCE_MOCK_SECRET debe tener al menos 32 caracteres",
      );
    }
    return createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex");
  }
}
