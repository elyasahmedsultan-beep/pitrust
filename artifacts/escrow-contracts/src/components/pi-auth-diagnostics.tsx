import {
  getPiRuntimeDiagnostics,
  getPiSdkTimingSnapshot,
  type PiRuntimeDiagnostics,
  type PiSdkTimingSnapshot,
} from "@/lib/pi-sdk";

export type DiagnosticResult = {
  outcome: "pending" | "success" | "failure" | "not-observed";
  status?: number;
  code?: string;
  reason?: string;
};

export type PiAuthDiagnosticSnapshot = {
  piType: string;
  piSdkStatus: "loading" | "ready" | "failed";
  piSandbox: boolean;
  runtime: PiRuntimeDiagnostics;
  timings: PiSdkTimingSnapshot;
  inIframe: boolean;
  incompletePaymentFound: boolean;
  origin: string;
  cookieEnabled: boolean;
  storage: {
    cookieTest: "pending" | "success" | "failure";
    localStorage: "pending" | "success" | "failure";
    sessionStorage: "pending" | "success" | "failure";
  };
  flow: {
    piAuthenticateCall: DiagnosticResult;
    piAuthenticateResult: DiagnosticResult;
    api: DiagnosticResult;
    signIn: DiagnosticResult;
    setActive: DiagnosticResult;
    session: DiagnosticResult;
    user: DiagnosticResult;
    touch: DiagnosticResult;
  };
};

export type DiagnosticFlowStep = keyof PiAuthDiagnosticSnapshot["flow"];
export type ClerkRequestKind = "signIn" | "touch";
export type PiAuthContext = "top-level" | "iframe";

type SafeComparisonResult = Pick<DiagnosticResult, "outcome" | "status" | "code">;

export type PiAuthContextComparisonEntry = {
  context: PiAuthContext;
  origin: string;
  recordedAt: number;
  flow: Partial<Record<DiagnosticFlowStep, SafeComparisonResult>>;
};

export type PiAuthContextComparison = {
  topLevel?: PiAuthContextComparisonEntry;
  iframe?: PiAuthContextComparisonEntry;
  storageAvailable: boolean;
};

const COMPARISON_STORAGE_KEY = "__pitrust_pi_auth_context_comparison_v1__";
const COMPARISON_MAX_AGE_MS = 30 * 60 * 1000;
const comparisonFlowSteps: DiagnosticFlowStep[] = [
  "piAuthenticateCall",
  "piAuthenticateResult",
  "api",
  "signIn",
  "setActive",
  "session",
  "user",
  "touch",
];

const pending = (): DiagnosticResult => ({ outcome: "pending" });

export function createPiAuthDiagnosticSnapshot(
  piSdkStatus: PiAuthDiagnosticSnapshot["piSdkStatus"] = "loading",
  piSandbox = true,
): PiAuthDiagnosticSnapshot {
  const runtime = getPiRuntimeDiagnostics();

  return {
    piType: typeof (window as Window & { Pi?: unknown }).Pi,
    piSdkStatus,
    piSandbox,
    runtime,
    timings: getPiSdkTimingSnapshot(),
    inIframe: runtime.inIframe,
    incompletePaymentFound: false,
    origin: runtime.origin,
    cookieEnabled: navigator.cookieEnabled,
    storage: {
      cookieTest: "pending",
      localStorage: "pending",
      sessionStorage: "pending",
    },
    flow: {
      piAuthenticateCall: pending(),
      piAuthenticateResult: pending(),
      api: pending(),
      signIn: pending(),
      setActive: pending(),
      session: pending(),
      user: pending(),
      touch: pending(),
    },
  };
}

function testStorage(kind: "localStorage" | "sessionStorage"): "success" | "failure" {
  const key = "__pitrust_diag_probe_v1__";
  let storage: Storage | undefined;
  let previousValue: string | null | undefined;

  try {
    storage = window[kind];
    previousValue = storage.getItem(key);
    storage.setItem(key, "probe");
    const succeeded = storage.getItem(key) === "probe";
    if (previousValue === null) storage.removeItem(key);
    else if (previousValue !== undefined) storage.setItem(key, previousValue);
    return succeeded ? "success" : "failure";
  } catch {
    try {
      if (storage && previousValue === null) storage.removeItem(key);
      else if (storage && typeof previousValue === "string") storage.setItem(key, previousValue);
    } catch {
      // Storage may be blocked; the diagnostic result is failure either way.
    }
    return "failure";
  }
}

export function runPiAuthStorageDiagnostics(): PiAuthDiagnosticSnapshot["storage"] {
  let cookieTest: "success" | "failure" = "failure";
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  try {
    document.cookie = `diag_test=probe; Path=/; Max-Age=30; SameSite=None${secure}`;
    cookieTest = document.cookie
      .split(";")
      .some((cookie) => cookie.trim() === "diag_test=probe")
      ? "success"
      : "failure";
  } catch {
    cookieTest = "failure";
  } finally {
    try {
      document.cookie = `diag_test=; Path=/; Max-Age=0; SameSite=None${secure}`;
    } catch {
      // The cookie probe can fail in restricted browser contexts.
    }
  }

  return {
    cookieTest,
    localStorage: testStorage("localStorage"),
    sessionStorage: testStorage("sessionStorage"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function safeCode(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 31 &&
    /^[A-Za-z0-9_.-]{1,31}$/.test(value)
    ? value
    : undefined;
}

function safeReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const reason = value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [hidden]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[hidden]")
    .replace(/\b(?:pi|sess|ticket|sk|pk)_[A-Za-z0-9._-]+\b/gi, "[hidden]")
    .replace(/\b[a-f0-9]{40,}\b/gi, "[hidden]")
    .replace(/[A-Za-z0-9_~+/=-]{32,}/g, "[hidden]")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[hidden]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 180);
  return reason || undefined;
}

export function diagnosticDetailsFromUnknown(value: unknown): Pick<DiagnosticResult, "status" | "code" | "reason"> {
  const record = asRecord(value);
  const firstError = Array.isArray(record?.errors)
    ? asRecord(record.errors[0])
    : undefined;
  const status = typeof record?.status === "number"
    ? record.status
    : typeof record?.statusCode === "number"
      ? record.statusCode
      : undefined;
  const code = safeCode(firstError?.code) ?? safeCode(record?.code);
  const reason = safeReason(
    firstError?.long_message ??
    firstError?.longMessage ??
    firstError?.message ??
    record?.long_message ??
    record?.message ??
    record?.error,
  );

  return {
    ...(status === undefined ? {} : { status }),
    ...(code ? { code } : {}),
    ...(reason ? { reason } : {}),
  };
}

function safeComparisonResult(value: unknown): SafeComparisonResult | undefined {
  const record = asRecord(value);
  const outcomes: DiagnosticResult["outcome"][] = [
    "pending",
    "success",
    "failure",
    "not-observed",
  ];
  if (!record || !outcomes.includes(record.outcome as DiagnosticResult["outcome"])) {
    return undefined;
  }

  const status = typeof record.status === "number" &&
      Number.isInteger(record.status) &&
      record.status >= 100 &&
      record.status <= 599
    ? record.status
    : undefined;
  const code = safeCode(record.code);

  return {
    outcome: record.outcome as DiagnosticResult["outcome"],
    ...(status === undefined ? {} : { status }),
    ...(code ? { code } : {}),
  };
}

function safeComparisonEntry(
  value: unknown,
  context: PiAuthContext,
  currentOrigin: string,
  now: number,
): PiAuthContextComparisonEntry | undefined {
  const record = asRecord(value);
  if (
    !record ||
    record.context !== context ||
    record.origin !== currentOrigin ||
    typeof record.recordedAt !== "number" ||
    !Number.isFinite(record.recordedAt) ||
    now - record.recordedAt > COMPARISON_MAX_AGE_MS ||
    record.recordedAt > now + 60_000
  ) {
    return undefined;
  }

  const rawFlow = asRecord(record.flow);
  const flow: PiAuthContextComparisonEntry["flow"] = {};
  for (const step of comparisonFlowSteps) {
    const result = safeComparisonResult(rawFlow?.[step]);
    if (result) flow[step] = result;
  }

  return {
    context,
    origin: currentOrigin,
    recordedAt: record.recordedAt,
    flow,
  };
}

export function readPiAuthContextComparison(): PiAuthContextComparison {
  try {
    const raw = window.localStorage.getItem(COMPARISON_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const record = asRecord(parsed);
    const now = Date.now();

    return {
      topLevel: safeComparisonEntry(record?.topLevel, "top-level", window.location.origin, now),
      iframe: safeComparisonEntry(record?.iframe, "iframe", window.location.origin, now),
      storageAvailable: true,
    };
  } catch {
    return { storageAvailable: false };
  }
}

export function savePiAuthContextComparison(
  snapshot: PiAuthDiagnosticSnapshot,
): PiAuthContextComparison {
  const current = readPiAuthContextComparison();
  const context: PiAuthContext = snapshot.inIframe ? "iframe" : "top-level";
  const flow: PiAuthContextComparisonEntry["flow"] = {};
  for (const step of comparisonFlowSteps) {
    const result = safeComparisonResult(snapshot.flow[step]);
    if (result) flow[step] = result;
  }

  const entry: PiAuthContextComparisonEntry = {
    context,
    origin: snapshot.origin,
    recordedAt: Date.now(),
    flow,
  };
  const comparison: PiAuthContextComparison = {
    ...current,
    [context]: entry,
    storageAvailable: true,
  };

  try {
    window.localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify({
      topLevel: comparison.topLevel,
      iframe: comparison.iframe,
    }));
    return comparison;
  } catch {
    return { ...current, storageAvailable: false };
  }
}

export async function diagnosticFromResponse(response: Response): Promise<DiagnosticResult> {
  if (response.ok) {
    return { outcome: "success", status: response.status };
  }

  let details: Pick<DiagnosticResult, "code" | "reason"> = {};
  try {
    details = diagnosticDetailsFromUnknown(await response.clone().json());
  } catch {
    details = { reason: "تعذر قراءة تفاصيل استجابة الخطأ." };
  }

  return {
    outcome: "failure",
    status: response.status,
    ...details,
  };
}

function requestPath(input: RequestInfo | URL): string | undefined {
  try {
    const rawUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    return new URL(rawUrl, window.location.origin).pathname;
  } catch {
    return undefined;
  }
}

export function watchClerkAuthRequests(
  onResult: (kind: ClerkRequestKind, result: DiagnosticResult) => void,
): () => void {
  const originalFetch = window.fetch;
  const trackedFetch: typeof window.fetch = async (input, init) => {
    const response = await originalFetch.call(window, input, init);
    const path = requestPath(input);
    const kind: ClerkRequestKind | undefined =
      path?.endsWith("/v1/client/sign_ins")
        ? "signIn"
        : path && /\/v1\/client\/sessions\/[^/]+\/touch$/.test(path)
          ? "touch"
          : undefined;

    if (kind) {
      try {
        onResult(kind, await diagnosticFromResponse(response));
      } catch {
        onResult(kind, {
          outcome: "failure",
          status: response.status,
          reason: "تعذر قراءة نتيجة طلب Clerk.",
        });
      }
    }

    return response;
  };

  window.fetch = trackedFetch;
  return () => {
    if (window.fetch === trackedFetch) window.fetch = originalFetch;
  };
}

function resultText(result: DiagnosticResult): string {
  if (result.outcome === "pending") return "بانتظار النتيجة";
  if (result.outcome === "not-observed") return "لم يُرصد";

  const parts = [
    result.outcome === "success" ? "نجح" : "فشل",
    result.status === undefined ? undefined : String(result.status),
    result.code,
    result.reason,
  ].filter(Boolean);
  return parts.join(" · ");
}

function ResultRow({ label, result }: { label: string; result: DiagnosticResult }) {
  const color = result.outcome === "success"
    ? "text-[#1DE9B6]"
    : result.outcome === "failure"
      ? "text-[#ff9b8e]"
      : "text-[#c5d0c9]";

  return (
    <div className="break-words">
      <span className="font-semibold text-white">{label}:</span>{" "}
      <span className={color}>{resultText(result)}</span>
    </div>
  );
}

function comparisonSummary(entry: PiAuthContextComparisonEntry | undefined): string {
  if (!entry) return "لا توجد تجربة محفوظة";
  const pi = entry.flow.piAuthenticateResult ?? entry.flow.piAuthenticateCall;
  const api = entry.flow.api;
  const touch = entry.flow.touch;
  return [
    `Pi: ${pi ? resultText(pi) : "لم تُسجّل"}`,
    `API: ${api ? resultText(api) : "لم تُسجّل"}`,
    `touch: ${touch ? resultText(touch) : "لم تُسجّل"}`,
  ].join(" · ");
}

export function PiAuthDiagnosticsPanel({
  snapshot,
  redirectInSeconds,
  comparison,
}: {
  snapshot: PiAuthDiagnosticSnapshot;
  redirectInSeconds: number | null;
  comparison: PiAuthContextComparison;
}) {
  const storageText = (value: PiAuthDiagnosticSnapshot["storage"][keyof PiAuthDiagnosticSnapshot["storage"]]) =>
    value === "success" ? "نجح" : value === "failure" ? "فشل" : "بانتظار";
  const timingText = (value: number | null) =>
    value === null ? "لم يُقَس" : `${value} ms`;

  const steps: Array<[string, DiagnosticResult]> = [
    ["استُدعيت Pi.authenticate", snapshot.flow.piAuthenticateCall],
    ["نتيجة Pi.authenticate", snapshot.flow.piAuthenticateResult],
    ["POST /api/pi/session", snapshot.flow.api],
    ["Clerk sign_in", snapshot.flow.signIn],
    ["setActive", snapshot.flow.setActive],
    ["جلسة تطبيق Pi", snapshot.flow.session],
    ["Clerk.user", snapshot.flow.user],
    ["Clerk touch", snapshot.flow.touch],
  ];

  return (
    <section
      role="status"
      aria-live="polite"
      dir="rtl"
      className="fixed inset-x-0 bottom-0 z-[9999] max-h-[25dvh] overflow-y-auto border-t border-[#526259] bg-[#101512]/[.98] px-2 py-1.5 text-[9px] leading-4 text-[#d4ded8] shadow-[0_-8px_30px_rgba(0,0,0,.45)] sm:px-4"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3">
          <strong className="text-[10px] text-white">تشخيص مؤقت لـ Pi وClerk</strong>
          <span>URL: {snapshot.runtime.appUrl}</span>
          <span>Origin: {snapshot.origin}</span>
          <span>Pi SDK: {snapshot.piSdkStatus}</span>
          <span>Pi Sandbox: {snapshot.piSandbox ? "نعم" : "لا"}</span>
          {redirectInSeconds !== null && (
            <span className="text-[#1DE9B6]">الانتقال خلال {redirectInSeconds} ثوانٍ</span>
          )}
        </div>
        <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0 border-b border-[#29332e] pb-1">
          <span>المتصفح: {snapshot.runtime.browser}</span>
          <span>النظام: {snapshot.runtime.operatingSystem}</span>
          <span>إشارة Pi Browser من UA: {snapshot.runtime.piBrowserUserAgentMatch ? "نعم" : "لا (غير حاسم)"}</span>
          <span>HTTPS secure context: {snapshot.runtime.secureContext ? "نعم" : "لا"}</span>
          <span>typeof window.Pi: {snapshot.piType}</span>
          <span>داخل iframe: {snapshot.inIframe ? "نعم" : "لا"}</span>
          <span>navigator.cookieEnabled: {snapshot.cookieEnabled ? "نعم" : "لا"}</span>
          <span>كوكي diag_test: {storageText(snapshot.storage.cookieTest)}</span>
          <span>localStorage: {storageText(snapshot.storage.localStorage)}</span>
          <span>sessionStorage: {storageText(snapshot.storage.sessionStorage)}</span>
          <span>onIncompletePaymentFound: {snapshot.incompletePaymentFound ? "تم استدعاؤه" : "لم يُرصد"}</span>
        </div>
        <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0 border-b border-[#29332e] pb-1">
          <span>تحميل Pi SDK: {timingText(snapshot.timings.sdkLoadMs)}</span>
          <span>Pi.init: {timingText(snapshot.timings.piInitMs)}</span>
          <span>Pi.authenticate: {timingText(snapshot.timings.authenticateMs)}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
          {steps.map(([label, result]) => (
            <ResultRow key={label} label={label} result={result} />
          ))}
        </div>
        <div className="mt-1 border-t border-[#29332e] pt-1">
          <strong className="text-white">مقارنة السياق (آخر 30 دقيقة):</strong>
          <div>الصفحة العلوية: <span className="text-[#d4ded8]">{comparisonSummary(comparison.topLevel)}</span></div>
          <div>داخل iframe: <span className="text-[#d4ded8]">{comparisonSummary(comparison.iframe)}</span></div>
          <p className="text-[#aebbb3]">
            {comparison.storageAvailable
              ? "تُحفظ حالات ونتائج ورموز أخطاء منقّحة فقط؛ قد يعزل المتصفح localStorage بين السياقين."
              : "تعذر حفظ مقارنة السياق في localStorage؛ ستظهر نتائج المحاولة الحالية فقط."}
          </p>
        </div>
      </div>
    </section>
  );
}