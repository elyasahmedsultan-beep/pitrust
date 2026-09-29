import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { resolvePiIframeSessionUserId } from "./piIframeSession.ts";
import { parsePiAppSessionCookie, resolvePiAppSession } from "./piAppSession.ts";
import { resolveAuthenticatedUserId as resolveSessionIdentity } from "./sessionIdentity.ts";
import { supabaseRequest } from "./supabase";

declare global {
  namespace Express {
    interface Request {
      piIframeSessionUserId?: string;
      piAppSessionUserId?: string;
      piAppSessionPiUid?: string;
      piAppSessionUsername?: string | null;
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
  const token = parsePiAppSessionCookie(req.get("cookie"));
  if (!token) {
    next();
    return;
  }
  try {
    const session = await resolvePiAppSession(token, {
      findSession: findPiAppSession,
      findUserIdByPiUid,
    });
    if (session) {
      req.piAppSessionUserId = session.userId;
      req.piAppSessionPiUid = session.piUid;
      req.piAppSessionUsername = session.username;
    }
    next();
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Could not resolve Pi app session",
    );
    res.status(503).json({ error: "Pi app session is temporarily unavailable" });
  }
}

export function authenticatedUserId(req: Request): string | null {
  return resolveSessionIdentity({
    clerkUserId: getAuth(req).userId ?? null,
    piIframeSessionUserId: req.piIframeSessionUserId ?? null,
    piAppSessionUserId: req.piAppSessionUserId ?? null,
  });
}

export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!authenticatedUserId(req)) {
    res.status(401).json({ error: "Authentication required" });
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