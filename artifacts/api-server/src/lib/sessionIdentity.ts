export type SessionIdentities = {
  clerkUserId: string | null;
  piIframeSessionUserId: string | null;
  piAppSessionUserId: string | null;
  piAccessTokenUserId?: string | null;
};

export function shouldInvokeClerkMiddleware(
  path: string,
  hasPiSession: boolean,
): boolean {
  const normalizedPath = path.split("?")[0] || "/";
  if (
    normalizedPath === "/pi/session" ||
    normalizedPath === "/listing-ad-fee" ||
    normalizedPath === "/pi/iframe-session" ||
    normalizedPath.startsWith("/pi/iframe-session/")
  ) {
    return false;
  }
  if (!hasPiSession) return true;
  return normalizedPath === "/pi/link" ||
    normalizedPath === "/admin" ||
    normalizedPath.startsWith("/admin/");
}

export function resolveAuthenticatedUserId({
  clerkUserId,
  piIframeSessionUserId,
  piAppSessionUserId,
  piAccessTokenUserId = null,
}: SessionIdentities): string | null {
  if (piAccessTokenUserId) {
    if (piAppSessionUserId && piAppSessionUserId !== piAccessTokenUserId) return null;
    if (piIframeSessionUserId && piIframeSessionUserId !== piAccessTokenUserId) return null;
    if (clerkUserId && clerkUserId !== piAccessTokenUserId) return null;
    return piAccessTokenUserId;
  }
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
  piAccessTokenUserId = null,
}: SessionIdentities): boolean {
  return Boolean(
    clerkUserId &&
    (!piIframeSessionUserId || piIframeSessionUserId === clerkUserId) &&
    (!piAppSessionUserId || piAppSessionUserId === clerkUserId) &&
    (!piAccessTokenUserId || piAccessTokenUserId === clerkUserId)
  );
}