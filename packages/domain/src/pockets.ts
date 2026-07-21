import { z } from "zod";

export const PocketVisibilitySchema = z.enum(["household", "private"]);
export const PocketPurposeSchema = z.enum([
  "daily_spend",
  "sinking_fund",
  "purchase",
  "emergency",
  "debt",
  "investment",
  "real_estate",
  "custom",
]);
export const FrequencySchema = z.enum(["weekly", "biweekly", "monthly"]);

const PositiveAmount = z
  .string()
  .refine((value) => Number(value) > 0, "Debe ser mayor que cero");

export const FundingPolicySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("target_by_date"),
    targetAmount: PositiveAmount,
    targetDate: z.iso.date(),
    frequency: FrequencySchema,
  }),
  z.object({
    kind: z.literal("target_by_contribution"),
    targetAmount: PositiveAmount,
    contributionAmount: PositiveAmount,
    frequency: FrequencySchema,
  }),
  z.object({
    kind: z.literal("periodic_spend"),
    limit: PositiveAmount,
    period: z.enum(["weekly", "monthly", "yearly"]),
  }),
]);

export const CreatePocketSchema = z.object({
  name: z.string().trim().min(1).max(80),
  purpose: PocketPurposeSchema.default("custom"),
  visibility: PocketVisibilitySchema.default("household"),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  currentAmount: z.string().default("0"),
  rolloverPolicy: z
    .enum(["none", "carry_balance", "carry_deficit"])
    .default("carry_balance"),
  policy: FundingPolicySchema,
});

export type FundingPolicy = z.infer<typeof FundingPolicySchema>;
export type CreatePocket = z.infer<typeof CreatePocketSchema>;
export type PocketVisibility = z.infer<typeof PocketVisibilitySchema>;
export type PocketPurpose = z.infer<typeof PocketPurposeSchema>;
export type Frequency = z.infer<typeof FrequencySchema>;

export function canReadPocket(
  pocket: {
    visibility: PocketVisibility;
    ownerMemberId: string;
    householdId: string;
  },
  actor: { memberId: string; householdId: string },
): boolean {
  if (pocket.householdId !== actor.householdId) return false;
  return (
    pocket.visibility === "household" || pocket.ownerMemberId === actor.memberId
  );
}

export function redactPrivateAllocation(memberDisplayName: string): string {
  return `Asignación personal — ${memberDisplayName}`;
}
