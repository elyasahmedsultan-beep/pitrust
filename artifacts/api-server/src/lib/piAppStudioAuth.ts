export type VerifiedPiIdentity = {
  uid: string;
  username: string | null;
};

export const PI_APP_STUDIO_LOGIN_URL =
  "https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function appStudioError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export async function verifyPiAccessTokenWithAppStudio(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<VerifiedPiIdentity> {
  if (!accessToken.trim()) {
    throw appStudioError("Pi access token is required", 401);
  }

  let response: Response;
  try {
    response = await fetchImpl(PI_APP_STUDIO_LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ accessToken }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw appStudioError("Pi App Studio identity verification is unavailable", 503);
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw appStudioError("Pi access token was rejected", 401);
  }
  if (!response.ok) {
    throw appStudioError("Pi App Studio identity verification is unavailable", 503);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw appStudioError("Pi App Studio returned an invalid identity response", 502);
  }

  if (typeof payload !== "object" || payload === null) {
    throw appStudioError("Pi App Studio returned an invalid identity response", 502);
  }

  const result = payload as {
    sessionToken?: unknown;
    user?: { uid?: unknown; username?: unknown };
  };
  const uid = typeof result.user?.uid === "string" ? result.user.uid.trim() : "";
  if (
    typeof result.sessionToken !== "string" ||
    !result.sessionToken.trim() ||
    !uid ||
    uid.length > 256
  ) {
    throw appStudioError("Pi App Studio returned an invalid identity response", 502);
  }

  const username = typeof result.user?.username === "string"
    ? result.user.username.trim().slice(0, 80)
    : "";

  return { uid, username: username || null };
}