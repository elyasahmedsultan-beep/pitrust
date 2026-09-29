import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { supabaseRequest } from "./supabase";
import { canUseClerkArbitratorIdentity } from "./sessionIdentity.ts";

export async function isArbitrator(userId: string): Promise<boolean> {
  const rows = await supabaseRequest<Array<{ is_arbitrator: boolean }>>(
    `escrow_profiles?user_id=eq.${encodeURIComponent(userId)}&select=is_arbitrator&limit=1`,
  );
  return rows[0]?.is_arbitrator === true;
}

export async function requireArbitrator(req: Request, res: Response): Promise<boolean> {
  const clerkUserId = getAuth(req).userId ?? null;
  if (!clerkUserId || !canUseClerkArbitratorIdentity({
    clerkUserId,
    piIframeSessionUserId: req.piIframeSessionUserId ?? null,
    piAppSessionUserId: req.piAppSessionUserId ?? null,
  })) {
    res.status(403).json({ error: "Clerk arbitrator authorization required" });
    return false;
  }
  try {
    if (await isArbitrator(clerkUserId)) return true;
    res.status(403).json({ error: "Arbitrator authorization required" });
    return false;
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not verify arbitrator permission");
    res.status(503).json({ error: "Arbitrator permissions are unavailable" });
    return false;
  }
}