import type { NextFunction, Request, Response } from "express";
import { isPiIframeSessionAllowed, type PiIframeSessionEnvironment } from "./piIframeSession.ts";

type TestnetWalletEnvironment = PiIframeSessionEnvironment & {
  NODE_ENV?: string;
};

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function isTestnetWalletHostAllowed(
  hostname: string,
  environment: TestnetWalletEnvironment = process.env,
): boolean {
  if (environment.PI_NETWORK?.trim().toLowerCase() !== "testnet") return false;
  if (isPiIframeSessionAllowed(hostname, environment)) return true;

  const host = normalizeHostname(hostname);
  const isLocalDevelopmentHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".replit.dev");
  return environment.NODE_ENV !== "production" && isLocalDevelopmentHost;
}

export function requireTestnetWalletAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isTestnetWalletHostAllowed(req.hostname)) {
    res.status(404).json({ error: "Testnet wallet is unavailable on this host" });
    return;
  }
  next();
}