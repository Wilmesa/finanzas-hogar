export interface TransactionMatchCandidate {
  amount: string;
  currency: string;
  occurredAt: string;
  merchant: string;
}

export interface TransactionMatchResult {
  matches: boolean;
  score: number;
  dateDistanceDays: number;
  merchantSimilarity: number;
}

function normalizeMerchant(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levenshteinDistance(left: string, right: string): number {
  const a = normalizeMerchant(left);
  const b = normalizeMerchant(right);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

export function merchantSimilarity(left: string, right: string): number {
  const a = normalizeMerchant(left);
  const b = normalizeMerchant(right);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return Math.max(0, 1 - levenshteinDistance(a, b) / longest);
}

export function matchImportedTransaction(
  incoming: TransactionMatchCandidate,
  candidate: TransactionMatchCandidate,
): TransactionMatchResult {
  const amountMatches =
    incoming.currency.toUpperCase() === candidate.currency.toUpperCase() &&
    Number(incoming.amount) === Number(candidate.amount);
  const dateDistanceDays = Math.round(
    Math.abs(
      new Date(incoming.occurredAt).getTime() -
        new Date(candidate.occurredAt).getTime(),
    ) / 86_400_000,
  );
  const similarity = merchantSimilarity(incoming.merchant, candidate.merchant);
  const score =
    (amountMatches ? 0.55 : 0) +
    (dateDistanceDays <= 3 ? 0.2 * (1 - dateDistanceDays / 4) : 0) +
    similarity * 0.25;
  return {
    matches: amountMatches && dateDistanceDays <= 3 && similarity >= 0.72,
    score: Number(score.toFixed(4)),
    dateDistanceDays,
    merchantSimilarity: Number(similarity.toFixed(4)),
  };
}

export function transactionFingerprint(
  input: TransactionMatchCandidate,
): string {
  return [
    Number(input.amount).toFixed(2),
    input.currency.toUpperCase(),
    input.occurredAt.slice(0, 10),
    normalizeMerchant(input.merchant),
  ].join("|");
}
