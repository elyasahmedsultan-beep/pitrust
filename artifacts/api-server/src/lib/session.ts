import { getAuth } from "@clerk/express";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { resolvePiIframeSessionUserId } from "./piIframeSession.ts";
import {
  hasPiAppSessionCookie,
  isPiAppSessionToken,
  parsePiAppSessionCookie,
  resolvePiAppSession,
} from "./piAppSession.ts";
import { resolveAuthenticatedUserId as resolveSessionIdentity } from "./sessionIdentity.ts";
import { supabaseRequest } from "./supabase";
import { verifyPiAccessTokenWithAppStudio, type VerifiedPiIdentity } from "./piAppStudioAuth.ts";

function errorStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: number }).status)
    : 502;
}

declare global {
  namespace Express {
    interface Request {
      piIframeSessionUserId?: string;
      piAppSessionUserId?: string;
      piAppSessionPiUid?: string;
      piAppSessionUsername?: string | null;
      piAppSessionResolution?: "missing" | "invalid" | "resolved";
      piAppSessionBearerTokenMatched?: boolean;
      piAccessTokenUserId?: string;
      piAccessTokenPiUid?: string;
    }
  }
}

async function findPiUidByTokenHash(
  tokenHash: string,
  now: string,
): Promise<string | null> {
  const rows = await supabaseRequest<Array<{ pi_uid: string }>>(
    `pi_iframe_sessions?token_hash=eq.${tokenHash}` +
      `&expires_at=gt.${encodeURIComponent(now)}&select=pi_uid&limit=1`,
  );
  return rows[0]?.pi_uid ?? null;
}

async function findUserIdByPiUid(piUid: string): Promise<string | null> {
  const rows = await supabaseRequest<Array<{ user_id: string }>>(
    `escrow_profiles?pi_uid=eq.${encodeURIComponent(piUid)}&select=user_id&limit=1`,
  );
  return rows[0]?.user_id ?? null;
}

const PI_ACCESS_TOKEN_CACHE_TTL_MS = 15_000;
const verifiedPiAccessTokenCache = new Map<string, {
  identity: VerifiedPiIdentity;
  expiresAt: number;
}>();
const pendingPiAccessTokenVerifications = new Map<string, Promise<VerifiedPiIdentity>>();

async function verifyCachedPiAccessToken(token: string): Promise<VerifiedPiIdentity> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const cached = verifiedPiAccessTokenCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;
  if (cached) verifiedPiAccessTokenCache.delete(tokenHash);
  const pending = pendingPiAccessTokenVerifications.get(tokenHash);
  if (pending) return pending;

  const verification = verifyPiAccessTokenWithAppStudio(token)
    .then((identity) => {
      if (verifiedPiAccessTokenCache.size >= 1_000) {
        const oldestHash = verifiedPiAccessTokenCache.keys().next().value;
        if (oldestHash) verifiedPiAccessTokenCache.delete(oldestHash);
      }
      verifiedPiAccessTokenCache.set(tokenHash, {
        identity,
        expiresAt: Date.now() + PI_ACCESS_TOKEN_CACHE_TTL_MS,
      });
      return identity;
    })
    .finally(() => pendingPiAccessTokenVerifications.delete(tokenHash));
  pendingPiAccessTokenVerifications.set(tokenHash, verification);
  return verification;
}

async function findPiAppSession(
  tokenHash: string,
  now: string,
): Promise<{ pi_uid: string; pi_username: string | null } | null> {
  const rows = await supabaseRequest<Array<{ pi_uid: string; pi_username: string | null }>>(
    `pi_app_sessions?token_hash=eq.${tokenHash}` +
      `&expires_at=gt.${encodeURIComponent(now)}&select=pi_uid,pi_username&limit=1`,
  );
  return rows[0] ?? null;
}

export async function attachPiIframeSessionUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.get("authorization") ?? "");
  const token = match?.[1];
  if (!token) {
    next();
    return;
  }

  try {
    const userId = await resolvePiIframeSessionUserId(
      token,
      req.hostname,
      { findPiUidByTokenHash, findUserIdByPiUid },
    );
    if (userId) req.piIframeSessionUserId = userId;
    next();
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Could not resolve Pi iframe app session",
    );
    res.status(503).json({ error: "Pi app session is temporarily unavailable" });
  }
}

export async function attachPiAppSessionUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cookieHeader = req.get("cookie");
  const cookieToken = parsePiAppSessionCookie(cookieHeader);
  const piSessionHeader = req.get("x-pi-session");
  const piSessionHeaderToken = piSessionHeader && isPiAppSessionToken(piSessionHeader)
    ? piSessionHeader
    : null;
  const bearerMatch = req.piIframeSessionUserId
    ? null
    : /^Bearer\s+([A-Za-z0-9_-]{43})$/i.exec(req.get("authorization") ?? "");
  const bearerToken = bearerMatch?.[1] && isPiAppSessionToken(bearerMatch[1])
    ? bearerMatch[1]
    : null;
  const tokens = [...new Set([cookieToken, piSessionHeaderToken, bearerToken].filter(
    (token): token is string => Boolean(token),
  ))];
  const hasExplicitAppSessionCredential =
    hasPiAppSessionCookie(cookieHeader) || Boolean(piSessionHeader);

  if (!tokens.length) {
    req.piAppSessionResolution = hasExplicitAppSessionCredential ? "invalid" : "missing";
    next();
    return;
  }
  try {
    const resolvedSessions = await Promise.all(tokens.map(async (token) => ({
      token,
      session: await resolvePiAppSession(token, {
        findSession: findPiAppSession,
        findUserIdByPiUid,
      }),
    })));
    const validSessions = resolvedSessions.filter(
      (entry): entry is { token: string; session: NonNullable<typeof entry.session> } =>
        Boolean(entry.session),
    );
    const distinctUserIds = new Set(validSessions.map(({ session }) => session.userId));
    if (distinctUserIds.size > 1) {
      res.status(409).json({
        error: "Pi session credentials belong to different Pactline accounts",
        code: "PI_SESSION_IDENTITY_CONFLICT",
      });
      return;
    }
    const resolvedSession = validSessions[0]?.session;
    if (resolvedSession) {
      req.piAppSessionUserId = resolvedSession.userId;
      req.piAppSessionPiUid = resolvedSession.piUid;
      req.piAppSessionUsername = resolvedSession.username;
      req.piAppSessionBearerTokenMatched = Boolean(
        bearerToken && validSessions.some(({ token }) => token === bearerToken),
      );
      req.piAppSessionResolution = "resolved";
    } else {
      req.piAppSessionResolution = hasExplicitAppSessionCredential ? "invalid" : "missing";
    }
    next();
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Could not resolve Pi app session",
    );
    res.status(503).json({
      error: "Pi app session is temporarily unavailable",
      code: "PI_APP_SESSION_LOOKUP_FAILED",
    });
  }
}

export async function attachPiAccessTokenUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const match = /^Bearer\s+([^\s]+)$/i.exec(req.get("authorization") ?? "");
  const token = match?.[1];
  const path = req.path.split("?")[0];
  if (
    !token ||
    req.piIframeSessionUserId ||
    req.piAppSessionBearerTokenMatched ||
    req.method === "OPTIONS" ||
    (req.method === "POST" && path === "/pi/session")
  ) {
    next();
    return;
  }
  try {
    const identity = await verifyCachedPiAccessToken(token);
    const userId = await findUserIdByPiUid(identity.uid);
    if (!userId) {
      next();
      return;
    }
    const resolved = resolveSessionIdentity({
      clerkUserId: null,
      piIframeSessionUserId: req.piIframeSessionUserId ?? null,
      piAppSessionUserId: req.piAppSessionUserId ?? null,
    });
    if (resolved && resolved !== userId) {
      res.status(409).json({ error: "This Pi identity is already linked to a different Pactline account" });
      return;
    }
    req.piAccessTokenUserId = userId;
    req.piAccessTokenPiUid = identity.uid;
    next();
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500 || status === 429) {
      req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not verify Pi access token");
      res.status(503).json({ error: "Pi identity verification is temporarily unavailable" });
      return;
    }
    next();
  }
}

export function authenticatedUserId(req: Request): string | null {
  const piIframeSessionUserId = req.piIframeSessionUserId ?? null;
  const piAppSessionUserId = req.piAppSessionUserId ?? null;
  const piAccessTokenUserId = req.piAccessTokenUserId ?? null;
  if (piIframeSessionUserId || piAppSessionUserId || piAccessTokenUserId) {
    return resolveSessionIdentity({
      clerkUserId: null,
      piIframeSessionUserId,
      piAppSessionUserId,
      piAccessTokenUserId,
    });
  }
  return resolveSessionIdentity({
    clerkUserId: getAuth(req).userId ?? null,
    piIframeSessionUserId,
    piAppSessionUserId,
    piAccessTokenUserId,
  });
}

export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!authenticatedUserId(req)) {
    res.set("Cache-Control", "private, no-store");
    res.status(401).json({
      error: "Authentication required",
      code: req.piAppSessionResolution === "invalid"
        ? "PI_APP_SESSION_INVALID"
        : "AUTHENTICATION_REQUIRED",
    });
    return;
  }
  next();
}

export function isContractParticipant(
  contract: { buyer_id?: string | null; seller_id?: string | null },
  userId: string,
): boolean {
  return contract.buyer_id === userId || contract.seller_id === userId;
}