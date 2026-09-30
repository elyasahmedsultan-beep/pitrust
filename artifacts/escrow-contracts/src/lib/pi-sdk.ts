import type { ListingAdPaymentIntent, MonthlyBadgeIntent, PaymentIntent } from "@workspace/api-client-react";
import { PI_INIT_OPTIONS, PI_SANDBOX } from "./pi-mainnet-config";

export type PiPayment = {
  identifier: string;
  metadata?: Record<string, unknown>;
  status?: {
    developer_approved?: boolean;
    transaction_verified?: boolean;
    developer_completed?: boolean;
    cancelled?: boolean;
    user_cancelled?: boolean;
  };
  transaction?: { txid?: string; verified?: boolean };
};
export type PiAuth = { accessToken: string; user: { uid: string } };
type PiIntent = PaymentIntent | MonthlyBadgeIntent | ListingAdPaymentIntent;

export type PiRuntimeDiagnostics = {
  appUrl: string;
  origin: string;
  browser: string;
  operatingSystem: string;
  piBrowserUserAgentMatch: boolean;
  inIframe: boolean;
  secureContext: boolean;
};

export type PiSdkTimingSnapshot = {
  sdkLoadMs: number | null;
  piInitMs: number | null;
  authenticateMs: number | null;
};

export type PiSdk = {
  init: (options: { version: "2.0"; sandbox: false }) => void | Promise<void>;
  authenticate: (
    scopes: string[],
    onIncompletePaymentFound: (payment: PiPayment) => void,
  ) => Promise<PiAuth>;
  createPayment: (
    intent: { amount: number; memo: string; metadata: PiIntent["metadata"] },
    callbacks: {
      onReadyForServerApproval: (paymentId: string) => void | Promise<void>;
      onReadyForServerCompletion: (paymentId: string, txid: string) => void | Promise<void>;
      onCancel: (paymentId: string) => void;
      onError: (error: unknown, payment?: PiPayment) => void;
    },
  ) => Promise<PiPayment>;
};

declare global {
  interface Window {
    Pi?: PiSdk;
  }
}

let sdkPromise: Promise<PiSdk> | null = null;
let initializationPromise: Promise<PiSdk> | null = null;
let piInitCalled = false;
let timingSnapshot: PiSdkTimingSnapshot = {
  sdkLoadMs: null,
  piInitMs: null,
  authenticateMs: null,
};

export { PI_SANDBOX };

function browserLabel(userAgent: string, piBrowserUserAgentMatch: boolean): string {
  if (piBrowserUserAgentMatch) return "Pi Browser (UA match)";
  if (/SamsungBrowser/i.test(userAgent)) return "Samsung Internet";
  if (/EdgA?|EdgiOS/i.test(userAgent)) return "Edge";
  if (/Firefox|FxiOS/i.test(userAgent)) return "Firefox";
  if (/CriOS|Chrome|Chromium/i.test(userAgent)) return "Chrome/Chromium";
  if (/Safari/i.test(userAgent)) return "Safari";
  return "Other/unknown";
}

function operatingSystemLabel(userAgent: string): string {
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS/iPadOS";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Other/unknown";
}

export function getPiRuntimeDiagnostics(): PiRuntimeDiagnostics {
  const userAgent = navigator.userAgent;
  const piBrowserUserAgentMatch = /PiBrowser|Pi Browser/i.test(userAgent);
  let inIframe = false;
  try {
    inIframe = window.self !== window.top;
  } catch {
    inIframe = true;
  }

  const appUrl = new URL(import.meta.env.BASE_URL || "/", window.location.origin);
  return {
    appUrl: `${appUrl.origin}${appUrl.pathname}`,
    origin: window.location.origin,
    browser: browserLabel(userAgent, piBrowserUserAgentMatch),
    operatingSystem: operatingSystemLabel(userAgent),
    piBrowserUserAgentMatch,
    inIframe,
    secureContext: window.isSecureContext,
  };
}

export function isPiBrowserRuntime(): boolean {
  return typeof navigator !== "undefined" &&
    /PiBrowser|Pi Browser/i.test(navigator.userAgent);
}

export function getPiSdkTimingSnapshot(): PiSdkTimingSnapshot {
  return { ...timingSnapshot };
}

export function recordPiAuthenticateDuration(durationMs: number): void {
  if (Number.isFinite(durationMs) && durationMs >= 0) {
    timingSnapshot = {
      ...timingSnapshot,
      authenticateMs: Math.round(durationMs),
    };
  }
}

export function resetPiAuthenticateDuration(): void {
  timingSnapshot = { ...timingSnapshot, authenticateMs: null };
}

const SAFE_DIAGNOSTIC_DETAIL_KEYS = new Set([
  "durationMs",
  "resourceStartMs",
  "source",
  "errorCode",
  "errorName",
  "scopes",
  "stage",
  "status",
  "sdkStatus",
  "outcome",
]);

export function logPiDiagnosticEvent(
  event: string,
  details: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const safeDetails: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_DIAGNOSTIC_DETAIL_KEYS.has(key)) continue;
    if (value === null || typeof value === "boolean") {
      safeDetails[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safeDetails[key] = Math.round(value);
    } else if (typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
      safeDetails[key] = value;
    }
  }

  console.info("[Pi diagnostics]", {
    event: event.slice(0, 64),
    eventAt: new Date().toISOString(),
    ...getPiRuntimeDiagnostics(),
    piSandbox: PI_SANDBOX,
    ...safeDetails,
  });
}

function latestPiSdkResourceTiming(): { durationMs: number; resourceStartMs: number } | null {
  const entries = performance.getEntriesByName("https://sdk.minepi.com/pi-sdk.js", "resource");
  const entry = entries[entries.length - 1];
  if (!entry) return null;
  return {
    durationMs: Math.round(entry.duration),
    resourceStartMs: Math.round(entry.startTime),
  };
}

export function loadPiSdk(): Promise<PiSdk> {
  if (sdkPromise) return sdkPromise;
  const startedAt = performance.now();
  if (window.Pi) {
    const resourceTiming = latestPiSdkResourceTiming();
    timingSnapshot = {
      ...timingSnapshot,
      sdkLoadMs: resourceTiming?.durationMs ?? null,
    };
    logPiDiagnosticEvent("sdk-load-observed", {
      source: "preloaded",
      durationMs: resourceTiming?.durationMs,
      resourceStartMs: resourceTiming?.resourceStartMs,
    });
    sdkPromise = Promise.resolve(window.Pi);
    return sdkPromise;
  }

  logPiDiagnosticEvent("sdk-load-start");
  sdkPromise = new Promise<PiSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.minepi.com/pi-sdk.js";
    script.async = true;
    script.onload = () => {
      if (window.Pi) {
        const durationMs = performance.now() - startedAt;
        timingSnapshot = { ...timingSnapshot, sdkLoadMs: Math.round(durationMs) };
        logPiDiagnosticEvent("sdk-load-success", {
          source: "script-load",
          durationMs,
        });
        resolve(window.Pi);
        return;
      }
      reject(new Error("Pi SDK did not expose window.Pi"));
    };
    script.onerror = () => reject(new Error("Pi SDK failed to load"));
    document.head.appendChild(script);
  }).catch((error) => {
    const durationMs = performance.now() - startedAt;
    timingSnapshot = { ...timingSnapshot, sdkLoadMs: Math.round(durationMs) };
    logPiDiagnosticEvent("sdk-load-failure", {
      durationMs,
      errorCode: error instanceof Error && error.message === "Pi SDK failed to load"
        ? "sdk_script_load_failed"
        : "pi_sdk_global_missing",
    });
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}

export function initializePiSdk(): Promise<PiSdk> {
  if (initializationPromise) return initializationPromise;
  initializationPromise = loadPiSdk()
    .then(async (pi) => {
      if (piInitCalled) throw new Error("Pi.init was already attempted; reload the page to retry");
      piInitCalled = true;
      const startedAt = performance.now();
      logPiDiagnosticEvent("pi-init-start", { source: "Pi.init" });
      try {
        await pi.init(PI_INIT_OPTIONS);
      } catch (error) {
        const durationMs = performance.now() - startedAt;
        timingSnapshot = { ...timingSnapshot, piInitMs: Math.round(durationMs) };
        logPiDiagnosticEvent("pi-init-failure", {
          durationMs,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        throw error;
      }
      const durationMs = performance.now() - startedAt;
      timingSnapshot = { ...timingSnapshot, piInitMs: Math.round(durationMs) };
      logPiDiagnosticEvent("pi-init-success", { durationMs });
      return pi;
    });
  return initializationPromise;
}