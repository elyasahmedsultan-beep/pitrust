import { createHash, randomBytes } from "node:crypto";

export const PI_IFRAME_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const DEFAULT_PI_IFRAME_SESSION_ALLOWED_HOSTS =
  "supabase-server-hub.replit.app";

export type PiIframeSessionEnvironment = {
  PI_IFRAME_SESSION_ENABLED?: string;
  PI_IFRAME_SESSION_ALLOWED_HOSTS?: string;
  PI_NETWORK?: string;
};

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function isPiTrustMainnetHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return host === "pitrustweb.com" || host.endsWith(".pitrustweb.com");
}

export function isPiIframeSessionAllowed(
  hostname: string,
  environment: PiIframeSessionEnvironment = process.env,
): boolean {
  if (environment.PI_IFRAME_SESSION_ENABLED !== "true") return false;
  if (environment.PI_NETWORK?.trim().toLowerCase() !== "testnet") return false;
  if (isPiTrustMainnetHost(hostname)) return false;

  const host = normalizeHostname(hostname);
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.includes("..")) {
    return false;
  }

  const allowlist =
    environment.PI_IFRAME_SESSION_ALLOWED_HOSTS ??
    DEFAULT_PI_IFRAME_SESSION_ALLOWED_HOSTS;

  return allowlist.split(",").some((entry) => {
    const allowedHost = normalizeHostname(entry);
    return /^[a-z0-9.-]+$/.test(allowedHost) &&
      !allowedHost.startsWith(".") &&
      !allowedHost.includes("..") &&
      !allowedHost.includes("*") &&
      host === allowedHost;
  });
}

export function createPiIframeSessionCredential(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashPiIframeSessionToken(token) };
}

export function hashPiIframeSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isPiIframeSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export type PiIframeSessionLookup = {
  findPiUidByTokenHash: (tokenHash: string, now: string) => Promise<string | null>;
  findUserIdByPiUid: (piUid: string) => Promise<string | null>;
};

export async function resolvePiIframeSessionUserId(
  token: string,
  hostname: string,
  lookup: PiIframeSessionLookup,
  environment: PiIframeSessionEnvironment = process.env,
): Promise<string | null> {
  if (!isPiIframeSessionAllowed(hostname, environment) || !isPiIframeSessionToken(token)) {
    return null;
  }

  const piUid = await lookup.findPiUidByTokenHash(
    hashPiIframeSessionToken(token),
    new Date().toISOString(),
  );
  if (!piUid) return null;
  return lookup.findUserIdByPiUid(piUid);
}