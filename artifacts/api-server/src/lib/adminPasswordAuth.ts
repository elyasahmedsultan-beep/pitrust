import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const ADMIN_SESSION_COOKIE = "pactline_admin_session";
export const ADMIN_SESSION_HEADER = "x-pactline-admin-session";
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const ADMIN_PASSWORD_MIN_LENGTH = 16;
const MAX_PASSWORD_LENGTH = 512;

type AdminSessionPayload = {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function signingKey(sessionSecret: string, adminPassword: string): Buffer {
  return createHmac("sha256", sessionSecret)
    .update("pactline-admin-session-signing-v1\0")
    .update(adminPassword)
    .digest();
}

export function adminPasswordConfigurationReady(): boolean {
  const password = process.env.ADMIN_SECRET_PASSWORD;
  return typeof password === "string" &&
    password.length >= ADMIN_PASSWORD_MIN_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH &&
    typeof process.env.SESSION_SECRET === "string" &&
    process.env.SESSION_SECRET.length > 0;
}

export function verifyAdminPassword(candidate: unknown, configured: string): boolean {
  if (typeof candidate !== "string" ||
    candidate.length > MAX_PASSWORD_LENGTH ||
    configured.length < ADMIN_PASSWORD_MIN_LENGTH ||
    configured.length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const configuredHash = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(candidateHash, configuredHash);
}

export function createAdminSessionToken(
  sessionSecret: string,
  adminPassword: string,
  now = Date.now(),
): string {
  const payload: AdminSessionPayload = {
    version: 1,
    issuedAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingKey(sessionSecret, adminPassword))
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function isValidAdminSessionToken(
  token: unknown,
  sessionSecret: string,
  adminPassword: string,
  now = Date.now(),
): boolean {
  if (typeof token !== "string") return false;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) return false;

  let suppliedSignature: Buffer;
  let payload: AdminSessionPayload;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as AdminSessionPayload;
  } catch {
    return false;
  }

  const expectedSignature = createHmac("sha256", signingKey(sessionSecret, adminPassword))
    .update(encodedPayload)
    .digest();
  if (suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)) {
    return false;
  }
  return payload.version === 1 &&
    Number.isSafeInteger(payload.issuedAt) &&
    Number.isSafeInteger(payload.expiresAt) &&
    payload.issuedAt <= now &&
    payload.expiresAt > now &&
    payload.expiresAt - payload.issuedAt === ADMIN_SESSION_TTL_MS &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 16;
}

function cookieValue(req: Request): string | null {
  const cookieHeader = req.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function hasAdminPasswordSession(req: Request): boolean {
  const sessionSecret = process.env.SESSION_SECRET;
  const adminPassword = process.env.ADMIN_SECRET_PASSWORD;
  if (!adminPasswordConfigurationReady() || !sessionSecret || !adminPassword) return false;
  if (isValidAdminSessionToken(cookieValue(req), sessionSecret, adminPassword)) return true;

  const iframeSessionToken = req.get(ADMIN_SESSION_HEADER);
  return Boolean(
    req.piIframeSessionUserId &&
    isValidAdminSessionToken(iframeSessionToken, sessionSecret, adminPassword),
  );
}

export function setAdminPasswordSessionCookie(req: Request, res: Response): void {
  const sessionSecret = process.env.SESSION_SECRET;
  const adminPassword = process.env.ADMIN_SECRET_PASSWORD;
  if (!adminPasswordConfigurationReady() || !sessionSecret || !adminPassword) {
    throw new Error("Admin session signing is unavailable");
  }
  res.cookie(
    ADMIN_SESSION_COOKIE,
    createAdminSessionToken(sessionSecret, adminPassword),
    {
      httpOnly: true,
      secure: req.secure,
      sameSite: "strict",
      path: "/",
      maxAge: ADMIN_SESSION_TTL_MS,
    },
  );
}

export function clearAdminPasswordSessionCookie(req: Request, res: Response): void {
  res.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    secure: req.secure,
    sameSite: "strict",
    path: "/",
  });
}

export function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin = req.get("origin");
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;

  if (!origin || !host || !protocol) {
    res.status(403).json({ error: "Same-origin request required" });
    return;
  }
  try {
    const requestOrigin = new URL(origin);
    const expectedOrigin = new URL(`${protocol}://${host}`);
    if (requestOrigin.origin !== expectedOrigin.origin) {
      res.status(403).json({ error: "Same-origin request required" });
      return;
    }
  } catch {
    res.status(403).json({ error: "Same-origin request required" });
    return;
  }
  next();
}

export function requireAdminPasswordSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!hasAdminPasswordSession(req)) {
    res.status(401).json({ error: "Admin password required" });
    return;
  }
  next();
}