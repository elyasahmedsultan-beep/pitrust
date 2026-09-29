export type SessionIdentities = {
  clerkUserId: string | null;
  piIframeSessionUserId: string | null;
  piAppSessionUserId: string | null;
};

export function resolveAuthenticatedUserId({
  clerkUserId,
  piIframeSessionUserId,
  piAppSessionUserId,
}: SessionIdentities): string | null {
  if (piAppSessionUserId) {
    if (piIframeSessionUserId && piIframeSessionUserId !== piAppSessionUserId) return null;
    return piAppSessionUserId;
  }
  if (
    clerkUserId &&
    piIframeSessionUserId &&
    clerkUserId !== piIframeSessionUserId
  ) return null;
  return piIframeSessionUserId ?? clerkUserId;
}

export function canUseClerkArbitratorIdentity({
  clerkUserId,
  piIframeSessionUserId,
  piAppSessionUserId,
}: SessionIdentities): boolean {
  return Boolean(
    clerkUserId &&
    (!piIframeSessionUserId || piIframeSessionUserId === clerkUserId) &&
    (!piAppSessionUserId || piAppSessionUserId === clerkUserId)
  );
}