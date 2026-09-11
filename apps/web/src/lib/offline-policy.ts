// Never replay a former member's queue under a new session, including legacy
// entries without an owner. They require explicit review, not silent reassignment.
export function canReplayOffline(
  item: { memberId?: string; path: string },
  session: { householdMemberId?: string; csrfToken?: string },
): boolean {
  return Boolean(
    item.memberId &&
    item.memberId === session.householdMemberId &&
    session.csrfToken &&
    item.path === "/api/v1/transactions",
  );
}
