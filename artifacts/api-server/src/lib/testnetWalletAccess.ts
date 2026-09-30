import type { NextFunction, Request, Response } from "express";

export function isTestnetWalletHostAllowed(
  _hostname: string,
  _environment: Record<string, string | undefined> = process.env,
): boolean {
  return false;
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