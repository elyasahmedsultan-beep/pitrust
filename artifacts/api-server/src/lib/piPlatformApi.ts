import { configuredPiNetworkApiKey } from "./piA2uConfig.ts";

const PI_API = "https://api.minepi.com/v2";
const PI_REQUEST_TIMEOUT_MS = 10_000;

export async function piRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = configuredPiNetworkApiKey();
  if (!key) {
    throw Object.assign(new Error("Pi Network API credentials are not configured"), {
      status: 503,
      provider: "pi",
      code: "PI_NETWORK_API_KEY_MISSING",
    });
  }

  let response: Response;
  try {
    response = await fetch(`${PI_API}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(PI_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw Object.assign(
      new Error(timedOut
        ? `Pi API request timed out after ${PI_REQUEST_TIMEOUT_MS / 1_000} seconds`
        : "Could not connect to the Pi API"),
      {
        status: timedOut ? 504 : 502,
        provider: "pi",
        code: timedOut ? "PI_API_TIMEOUT" : "PI_API_UNAVAILABLE",
        cause: error,
      },
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerCode = typeof payload === "object" && payload !== null &&
      "error" in payload && typeof payload.error === "string"
      ? payload.error
      : undefined;
    const paymentNotFound = response.status === 404 && providerCode === "payment_not_found";
    const rejectedKey = response.status === 401 || response.status === 403;
    const code = paymentNotFound
      ? "PI_PAYMENT_NOT_FOUND"
      : rejectedKey
        ? "PI_NETWORK_API_KEY_REJECTED"
        : "PI_API_ERROR";
    const message = paymentNotFound
      ? "Pi could not find this payment using the configured network and app key. Confirm it was created by this Pi app on the same network; older payments may need to be restarted."
      : rejectedKey
        ? `Pi rejected the server API key for the selected network (HTTP ${response.status})`
        : `Pi API request failed (HTTP ${response.status})`;
    throw Object.assign(new Error(message), {
      status: response.status >= 500 ? 502 : response.status,
      provider: "pi",
      code,
      details: payload,
    });
  }

  return payload as T;
}