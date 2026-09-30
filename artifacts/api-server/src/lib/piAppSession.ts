import { createHash, randomBytes } from "node:crypto";

export const PI_APP_SESSION_COOKIE = "pi_app_session";
export const LEGACY_PI_APP_SESSION_COOKIE = "pitrust_pi_session";
export const PI_APP_SESSION_TTL_SECONDS = 24 * 60 * 60;

export function createPiAppSessionCredential(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashPiAppSessionToken(token) };
}

export function hashPiAppSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isPiAppSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function parsePiAppSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== PI_APP_SESSION_COOKIE && name !== LEGACY_PI_APP_SESSION_COOKIE) continue;
    const value = valueParts.join("=");
    return isPiAppSessionToken(value) ? value : null;
  }
  return null;
}

export function hasPiAppSessionCookie(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => {
    const name = part.trim().split("=", 1)[0];
    return name === PI_APP_SESSION_COOKIE || name === LEGACY_PI_APP_SESSION_COOKIE;
  });
}

export type PiAppSessionLookup = {
  findSession: (tokenHash: string, now: string) => Promise<{
    pi_uid: string;
    pi_username: string | null;
  } | null>;
  findUserIdByPiUid: (piUid: string) => Promise<string | null>;
};

export async function resolvePiAppSession(
  token: string | null,
  lookup: PiAppSessionLookup,
): Promise<{ userId: string; piUid: string; username: string | null } | null> {
  if (!token || !isPiAppSessionToken(token)) return null;
  const session = await lookup.findSession(hashPiAppSessionToken(token), new Date().toISOString());
  if (!session) return null;
  const userId = await lookup.findUserIdByPiUid(session.pi_uid);
  return userId ? { userId, piUid: session.pi_uid, username: session.pi_username } : null;
}

function cookieOptions(
  cookieName: string,
  isSecure: boolean,
  maxAgeSeconds: number,
): string {
  return [
    `${cookieName}=`,
    "HttpOnly",
    ...(isSecure ? ["SameSite=None"] : ["SameSite=Lax"]),
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    ...(isSecure ? ["Secure"] : []),
  ].join("; ");
}

export function piAppSessionCookieOptions(
  isSecure: boolean,
  maxAgeSeconds = PI_APP_SESSION_TTL_SECONDS,
): string {
  return cookieOptions(PI_APP_SESSION_COOKIE, isSecure, maxAgeSeconds);
}

export function piAppSessionSetCookie(
  token: string,
  isSecure: boolean,
  maxAgeSeconds = PI_APP_SESSION_TTL_SECONDS,
): string {
  return piAppSessionCookieOptions(isSecure, maxAgeSeconds).replace(
    `${PI_APP_SESSION_COOKIE}=`,
    `${PI_APP_SESSION_COOKIE}=${token}`,
  );
}

export function piAppSessionClearCookies(isSecure: boolean): string[] {
  return [
    cookieOptions(PI_APP_SESSION_COOKIE, isSecure, 0),
    cookieOptions(LEGACY_PI_APP_SESSION_COOKIE, isSecure, 0),
  ];
}