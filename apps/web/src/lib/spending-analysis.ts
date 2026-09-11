import type { TransactionView } from "./types";

/** Do not turn pending captures, reversals or different currencies into real spending. */
export function spendingAnalysis(
  transactions: TransactionView[],
  currency: string,
) {
  const categories = new Map<string, number>();
  const payers = new Map<string, number>();
  for (const transaction of transactions) {
    if (
      transaction.kind !== "expense" ||
      transaction.currency !== currency ||
      (transaction.syncStatus && transaction.syncStatus !== "synchronized") ||
      transaction.reversed ||
      transaction.isReversal
    )
      continue;
    categories.set(
      transaction.category,
      (categories.get(transaction.category) ?? 0) + transaction.amount,
    );
    payers.set(
      transaction.payer,
      (payers.get(transaction.payer) ?? 0) + transaction.amount,
    );
  }
  const sorted = (values: Map<string, number>) =>
    [...values].sort((a, b) => b[1] - a[1]);
  return {
    categories: sorted(categories),
    payers: sorted(payers),
    total: [...categories.values()].reduce((a, b) => a + b, 0),
  };
}
