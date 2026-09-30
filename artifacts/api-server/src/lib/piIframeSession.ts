import { createHash, randomBytes } from "node:crypto";

export const PI_IFRAME_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type PiIframeSessionEnvironment = Record<string, string | undefined>;

export function isPiIframeSessionAllowed(
  _hostname: string,
  _environment: PiIframeSessionEnvironment = process.env,
): boolean {
  return false;
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