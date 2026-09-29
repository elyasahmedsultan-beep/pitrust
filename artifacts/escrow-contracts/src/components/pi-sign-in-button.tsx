import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { useI18n } from "@/i18n";
import { usePiIframeSession } from "@/lib/pi-iframe-session";
import { usePiAppSession } from "@/lib/pi-app-session";
import {
  getPiRuntimeDiagnostics,
  getPiSdkTimingSnapshot,
  initializePiSdk,
  logPiDiagnosticEvent,
  PI_SANDBOX,
  recordPiAuthenticateDuration,
  resetPiAuthenticateDuration,
  type PiPayment,
} from "@/lib/pi-sdk";
import {
  createPiAuthDiagnosticSnapshot,
  diagnosticDetailsFromUnknown,
  PiAuthDiagnosticsPanel,
  readPiAuthContextComparison,
  runPiAuthStorageDiagnostics,
  savePiAuthContextComparison,
  type DiagnosticFlowStep,
  type DiagnosticResult,
  type PiAuthDiagnosticSnapshot,
} from "@/components/pi-auth-diagnostics";

let piAuthenticateInFlight = false;

export function PiSignInButton({
  mode,
  modeSwitchLink,
}: {
  mode: "sign-in" | "sign-up";
  modeSwitchLink?: ReactNode;
}) {
  const [, setLocation] = useLocation();
  const { t } = useI18n();
  const { refresh: refreshPiAppSession } = usePiAppSession();
  const {
    session: iframeSession,
    setSession: setIframeSession,
    clearSession: clearIframeSession,
  } = usePiIframeSession();
  const iframeIdentityMode =
    PI_SANDBOX &&
    import.meta.env.VITE_PI_IFRAME_SESSION_ENABLED === "true" &&
    window.self !== window.top;
  const [busy, setBusy] = useState(false);
  const [piAuthenticatePending, setPiAuthenticatePending] = useState(false);
  const [error, setError] = useState("");
  const [requiresReload, setRequiresReload] = useState(false);
  const [sdkStatus, setSdkStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [diagnostics, setDiagnostics] = useState<PiAuthDiagnosticSnapshot>(
    () => createPiAuthDiagnosticSnapshot("loading", PI_SANDBOX),
  );
  const [redirectInSeconds, setRedirectInSeconds] = useState<number | null>(null);
  const [comparisonCaptureEnabled, setComparisonCaptureEnabled] = useState(false);
  const [comparison, setComparison] = useState(() => readPiAuthContextComparison());
  const attemptActiveRef = useRef(false);

  useEffect(() => {
    if (!comparisonCaptureEnabled) return;
    setComparison(savePiAuthContextComparison(diagnostics));
  }, [comparisonCaptureEnabled, diagnostics]);

  const updatePiSdkStatus = (status: "loading" | "ready" | "failed") => {
    setSdkStatus(status);
    setDiagnostics((current) => ({
      ...current,
      piType: typeof window.Pi,
      piSdkStatus: status,
      runtime: getPiRuntimeDiagnostics(),
      timings: getPiSdkTimingSnapshot(),
    }));
  };

  useEffect(() => {
    let active = true;
    const storage = runPiAuthStorageDiagnostics();
    setDiagnostics((current) => ({
      ...current,
      piType: typeof window.Pi,
      storage,
    }));
    void initializePiSdk()
      .then(() => {
        if (active) updatePiSdkStatus("ready");
      })
      .catch((cause: unknown) => {
        logPiDiagnosticEvent("sdk-initialization-failed", {
          errorName: cause instanceof Error ? cause.name : typeof cause,
        });
        if (active) updatePiSdkStatus("failed");
      });
    return () => {
      active = false;
    };
  }, []);

  const retrySdkLoad = async () => {
    window.location.reload();
  };

  const signInWithPi = async () => {
    logPiDiagnosticEvent("sign-in-button-click", { sdkStatus });
    if (
      busy ||
      sdkStatus !== "ready" ||
      attemptActiveRef.current ||
      piAuthenticateInFlight
    ) return;
    const pi = window.Pi;
    if (!pi) {
      setError(t("auth.piSignInFailed"));
      return;
    }
    attemptActiveRef.current = true;
    setBusy(true);
    setError("");
    setRequiresReload(false);
    setRedirectInSeconds(null);
    setComparisonCaptureEnabled(true);
    resetPiAuthenticateDuration();
    setDiagnostics((current) => ({
      ...createPiAuthDiagnosticSnapshot(sdkStatus, PI_SANDBOX),
      storage: current.storage,
    }));
    let stage = "pi-authenticate-call";
    let responseStatus: number | undefined;
    let piTimeoutHandle: number | undefined;
    let piTimedOut = false;
    let piCallRecorded = false;
    let piResultRecorded = false;
    let piAuthStartedAt: number | undefined;
    let piAuthTimingRecorded = false;
    let shouldRedirect = false;
    let apiResultRecorded = false;
    const recordPiAuthTiming = (event: string, errorCode?: string) => {
      if (piAuthStartedAt === undefined || piAuthTimingRecorded) return;
      const durationMs = Math.round(performance.now() - piAuthStartedAt);
      piAuthTimingRecorded = true;
      recordPiAuthenticateDuration(durationMs);
      setDiagnostics((current) => ({
        ...current,
        timings: getPiSdkTimingSnapshot(),
      }));
      logPiDiagnosticEvent(event, {
        durationMs,
        ...(errorCode ? { errorCode } : {}),
      });
    };
    const recordFlowStep = (step: DiagnosticFlowStep, result: DiagnosticResult) => {
      setDiagnostics((current) => ({
        ...current,
        flow: { ...current.flow, [step]: result },
      }));
    };
    const markPendingStepsNotObserved = (steps: DiagnosticFlowStep[]) => {
      setDiagnostics((current) => {
        const flow = { ...current.flow };
        for (const step of steps) {
          if (flow[step].outcome === "pending") {
            flow[step] = {
              outcome: "not-observed",
              reason: "لم تُنفّذ هذه الخطوة بعد فشل خطوة سابقة.",
            };
          }
        }
        return { ...current, flow };
      });
    };
    try {
      const onIncompletePaymentFound = (_payment: PiPayment) => {
        logPiDiagnosticEvent("incomplete-payment-found");
        setDiagnostics((current) => ({
          ...current,
          incompletePaymentFound: true,
        }));
      };

      // Call Pi synchronously in the original click stack; the SDK was initialized
      // before the button was enabled.
      piAuthenticateInFlight = true;
      setPiAuthenticatePending(true);
      piAuthStartedAt = performance.now();
      logPiDiagnosticEvent("authenticate-start", { scopes: "username" });
      const piAuthPromise = pi.authenticate(["username"], onIncompletePaymentFound);
      recordFlowStep("piAuthenticateCall", {
        outcome: "success",
        reason: "استُدعيت Pi.authenticate مباشرة من نقرة المستخدم.",
      });
      piCallRecorded = true;
      stage = "pi-authenticate-result";

      const observedPiAuthPromise = Promise.resolve(piAuthPromise).then(
        (auth) => ({ kind: "resolved" as const, auth }),
        (cause: unknown) => ({ kind: "rejected" as const, cause }),
      );
      void observedPiAuthPromise.then((outcome) => {
        piAuthenticateInFlight = false;
        setPiAuthenticatePending(false);
        if (piTimedOut) {
          const lateDurationMs = piAuthStartedAt === undefined
            ? undefined
            : Math.round(performance.now() - piAuthStartedAt);
          if (lateDurationMs !== undefined) {
            recordPiAuthenticateDuration(lateDurationMs);
            setDiagnostics((current) => ({
              ...current,
              timings: getPiSdkTimingSnapshot(),
            }));
          }
          logPiDiagnosticEvent("authenticate-late-settled", {
            ...(lateDurationMs === undefined ? {} : { durationMs: lateDurationMs }),
            outcome: outcome.kind,
          });
          setRequiresReload(false);
          attemptActiveRef.current = false;
          if (outcome.kind === "resolved") {
            recordFlowStep("piAuthenticateResult", {
              outcome: "not-observed",
              code: "late_pi_result_ignored",
              reason: "وصلت نتيجة Pi بعد انتهاء المهلة، ولم تُستخدم.",
            });
          }
        } else if (outcome.kind === "resolved") {
          recordPiAuthTiming("authenticate-success");
        } else {
          recordPiAuthTiming(
            "authenticate-failure",
            diagnosticDetailsFromUnknown(outcome.cause).code ?? "pi_auth_rejected",
          );
        }
      });

      const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
        piTimeoutHandle = window.setTimeout(
          () => resolve({ kind: "timeout" }),
          20_000,
        );
      });
      const piOutcome = await Promise.race([observedPiAuthPromise, timeoutPromise]);
      if (piTimeoutHandle !== undefined) {
        window.clearTimeout(piTimeoutHandle);
        piTimeoutHandle = undefined;
      }
      if (piOutcome.kind === "timeout") {
        piTimedOut = true;
        setRequiresReload(true);
        recordPiAuthTiming("authenticate-timeout", "pi_auth_timeout");
        recordFlowStep("piAuthenticateResult", {
          outcome: "failure",
          code: "pi_auth_timeout",
          reason: "لم يستجب Pi خلال 20 ثانية؛ بقي الطلب معلقًا.",
        });
        piResultRecorded = true;
        throw new Error("pi-auth-timeout");
      }
      if (piOutcome.kind === "rejected") {
        const details = diagnosticDetailsFromUnknown(piOutcome.cause);
        recordFlowStep("piAuthenticateResult", {
          outcome: "failure",
          code: details.code ?? "pi_auth_rejected",
          ...(details.reason ? { reason: details.reason } : {}),
        });
        piResultRecorded = true;
        throw piOutcome.cause;
      }

      recordFlowStep("piAuthenticateResult", { outcome: "success" });
      piResultRecorded = true;
      const auth = piOutcome.auth;
      if (!auth?.accessToken) {
        recordFlowStep("piAuthenticateResult", {
          outcome: "failure",
          code: "missing_pi_access_token",
          reason: "لم يُرجع Pi نتيجة مصادقة صالحة.",
        });
        throw new Error("Pi authentication did not return an access token");
      }

      const apiBase = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}api/`;
      if (iframeIdentityMode) {
        stage = "pi-iframe-session";
        const createResponse = await fetch(`${apiBase}pi/iframe-session`, {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: auth.accessToken, intent: mode }),
        });
        responseStatus = createResponse.status;
        const createPayload: unknown = await createResponse.json().catch(() => null);
        const createRecord = typeof createPayload === "object" && createPayload !== null
          ? createPayload as { sessionToken?: unknown; expiresAt?: unknown }
          : undefined;
        const sessionToken = typeof createRecord?.sessionToken === "string"
          ? createRecord.sessionToken
          : undefined;
        const expiresAt = typeof createRecord?.expiresAt === "string"
          ? createRecord.expiresAt
          : undefined;
        if (
          !createResponse.ok ||
          !sessionToken ||
          !expiresAt ||
          !Number.isFinite(Date.parse(expiresAt)) ||
          Date.parse(expiresAt) <= Date.now()
        ) {
          throw new Error("pi-iframe-session-create-failed");
        }

        const identityResponse = await fetch(
          `${apiBase}pi/iframe-session/identity`,
          {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            headers: { Authorization: `Bearer ${sessionToken}` },
          },
        );
        responseStatus = identityResponse.status;
        const identityPayload: unknown = await identityResponse.json().catch(() => null);
        const identityRecord = typeof identityPayload === "object" && identityPayload !== null
          ? identityPayload as { uid?: unknown; username?: unknown }
          : undefined;
        if (
          !identityResponse.ok ||
          typeof identityRecord?.uid !== "string" ||
          !identityRecord.uid ||
          !(typeof identityRecord.username === "string" || identityRecord.username === null)
        ) {
          throw new Error("pi-iframe-identity-verification-failed");
        }

        setIframeSession({
          token: sessionToken,
          expiresAt,
          identity: {
            uid: identityRecord.uid,
            username: identityRecord.username,
          },
        });
        recordFlowStep("api", { outcome: "success", status: createResponse.status });
        apiResultRecorded = true;
        setDiagnostics((current) => ({
          ...current,
          flow: {
            ...current.flow,
            signIn: {
              outcome: "not-observed",
              reason: "تم التحقق من الهوية دون إنشاء جلسة Clerk.",
            },
            setActive: {
              outcome: "not-observed",
              reason: "جلسة Pi هذه لا تنشئ جلسة Clerk.",
            },
            session: {
              outcome: "not-observed",
              reason: "جلسة Pi محفوظة في ذاكرة الصفحة فقط.",
            },
            user: {
              outcome: "not-observed",
              reason: "هذا المسار لا يحمّل مستخدم Clerk.",
            },
            touch: {
              outcome: "not-observed",
              reason: "لم يُستخدم Clerk في مسار الهوية هذا.",
            },
          },
        }));
        setLocation("/");
        return;
      }

      stage = "backend-authenticate";
      const response = await fetch(`${apiBase}pi/session`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: auth.accessToken, intent: mode }),
      });
      responseStatus = response.status;
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const payloadRecord = typeof payload === "object" && payload !== null
        ? payload as { authenticated?: unknown; accountId?: unknown; piUid?: unknown; username?: unknown }
        : undefined;
      const appSessionConfirmed = response.ok &&
        payloadRecord?.authenticated === true &&
        typeof payloadRecord.accountId === "string" &&
        typeof payloadRecord.piUid === "string";
       const apiResult: DiagnosticResult = appSessionConfirmed
        ? { outcome: "success", status: response.status }
        : {
            outcome: "failure",
            status: response.status,
            ...diagnosticDetailsFromUnknown(payload),
            ...(response.ok
              ? { code: "missing_pi_app_session", reason: "لم يؤكد الخادم جلسة Pi." }
              : {}),
          };
      apiResultRecorded = true;
      recordFlowStep("api", apiResult);
      const storage = runPiAuthStorageDiagnostics();
      setDiagnostics((current) => ({ ...current, storage }));

      if (!appSessionConfirmed) {
        if (response.status === 409) throw new Error(t("auth.identityConflict"));
        if (response.status === 404) throw new Error(t("auth.piNotLinked"));
        throw new Error(t("auth.piSignInFailed"));
      }
      stage = "verify-pi-app-session";
      const sessionConfirmed = await refreshPiAppSession();
      recordFlowStep("session", sessionConfirmed
        ? { outcome: "success", reason: "تم تأكيد جلسة Pi الخاصة بالتطبيق." }
        : { outcome: "failure", code: "pi_app_session_missing", reason: "لم تظهر جلسة Pi بعد الاستجابة الناجحة." });
      recordFlowStep("signIn", { outcome: "not-observed", reason: "لا يحتاج مسار Pi إلى جلسة Clerk." });
      recordFlowStep("setActive", { outcome: "not-observed", reason: "لا يحتاج مسار Pi إلى Clerk." });
      recordFlowStep("user", { outcome: "not-observed", reason: "هوية التطبيق مصدرها Pi." });
      recordFlowStep("touch", { outcome: "not-observed", reason: "لم يُستخدم Clerk في مسار الهوية هذا." });
      if (!sessionConfirmed) throw new Error("pi-app-session-not-confirmed");
      shouldRedirect = true;
    } catch (cause) {
      setRedirectInSeconds(null);
      const errorDetails = diagnosticDetailsFromUnknown(cause);
      if (stage === "pi-authenticate-call") {
        piAuthenticateInFlight = false;
        setPiAuthenticatePending(false);
        recordPiAuthTiming(
          "authenticate-failure",
          errorDetails.code ?? "pi_auth_call_failed",
        );
        if (!piCallRecorded) {
          recordFlowStep("piAuthenticateCall", {
            outcome: "failure",
            code: errorDetails.code ?? "pi_auth_call_failed",
            ...(errorDetails.reason ? { reason: errorDetails.reason } : {}),
          });
        }
        if (!piResultRecorded) {
          recordFlowStep("piAuthenticateResult", {
            outcome: "not-observed",
            reason: "لم يُرجع استدعاء Pi طلبًا لمتابعة نتيجته.",
          });
        }
        markPendingStepsNotObserved(["api", "signIn", "setActive", "session", "user", "touch"]);
      } else if (stage === "pi-authenticate-result") {
        if (!piResultRecorded) {
          recordFlowStep("piAuthenticateResult", {
            outcome: "failure",
            code: errorDetails.code ?? "pi_auth_failed",
            ...(errorDetails.reason ? { reason: errorDetails.reason } : {}),
          });
        }
        markPendingStepsNotObserved(["api", "signIn", "setActive", "session", "user", "touch"]);
      } else if (stage === "backend-authenticate") {
        markPendingStepsNotObserved(["signIn", "setActive", "session", "user", "touch"]);
      } else if (stage === "pi-iframe-session") {
        if (!apiResultRecorded) {
          recordFlowStep("api", {
            outcome: "failure",
            status: responseStatus,
            code: "pi_iframe_session_failed",
            reason: "تعذر إنشاء جلسة هوية Pi قصيرة العمر.",
          });
        }
        markPendingStepsNotObserved(["signIn", "setActive", "session", "user", "touch"]);
      }
      if (stage === "backend-authenticate" && !apiResultRecorded) {
        recordFlowStep("api", {
          outcome: "failure",
          code: "request_failed",
          reason: "تعذر الاتصال بخادم تسجيل الدخول.",
        });
        const storage = runPiAuthStorageDiagnostics();
        setDiagnostics((current) => ({ ...current, storage }));
      }
      logPiDiagnosticEvent("sign-in-flow-failed", {
        stage,
        sdkStatus,
        status: responseStatus,
        errorName: cause instanceof Error ? cause.name : typeof cause,
        errorCode: errorDetails.code ?? "sign_in_flow_failed",
      });
      const message = cause instanceof Error &&
        (cause.message === t("auth.identityConflict") || cause.message === t("auth.piNotLinked"))
        ? cause.message
        : cause instanceof Error && cause.message === "pi-auth-timeout"
          ? t("auth.piAuthTimedOut")
          : t("auth.piSignInFailed");
      setError(message);
    } finally {
      if (piTimeoutHandle !== undefined) window.clearTimeout(piTimeoutHandle);
      setBusy(false);
      if (!piAuthenticateInFlight) attemptActiveRef.current = false;
    }

    if (shouldRedirect) window.location.replace(import.meta.env.BASE_URL);
  };

  return (
    <div className="mx-auto mt-4 w-full max-w-[400px]">
      <button
        type="button"
        onClick={() => void signInWithPi()}
        disabled={busy || piAuthenticatePending || sdkStatus !== "ready"}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-[#3b5144] bg-[#17221b] px-5 py-3 text-sm font-semibold text-[#f2f5f3] transition hover:border-[#1DE9B6] hover:bg-[#1b3023] disabled:cursor-not-allowed disabled:opacity-60"
        data-testid={mode === "sign-in" ? "button-sign-in-pi" : "button-sign-up-pi"}
      >
        <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-[#1DE9B6] font-['Syne'] text-sm font-bold text-[#07130B]">π</span>
        {busy || sdkStatus === "loading" || piAuthenticatePending
          ? piAuthenticatePending && !busy
            ? t("auth.piAuthStillPending")
            : t("auth.connectingWithPi")
          : iframeIdentityMode
            ? document.documentElement.dir === "rtl"
              ? "تسجيل الدخول عبر Pi"
              : "Sign in with Pi"
            : mode === "sign-in" ? t("auth.signInWithPi") : t("auth.signUpWithPi")}
      </button>
      {modeSwitchLink}
      {iframeIdentityMode && iframeSession && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-[#28583c] bg-[#102117] px-4 py-3 text-center text-xs leading-6 text-[#b7c5bc]"
          data-testid="pi-iframe-identity-session"
        >
          <p>
            {document.documentElement.dir === "rtl"
              ? "تم تسجيل الدخول عبر Pi في بيئة Sandbox. تنتهي الجلسة بعد 8 ساعات."
              : "Signed in with Pi in the Sandbox. This session expires after 8 hours."}
          </p>
          {iframeSession.identity.username && (
            <p className="font-medium text-[#1DE9B6]">
              @{iframeSession.identity.username}
            </p>
          )}
          <button
            type="button"
            onClick={clearIframeSession}
            className="mt-1 text-[#1DE9B6] underline underline-offset-4"
            data-testid="button-clear-pi-iframe-session"
          >
            {document.documentElement.dir === "rtl" ? "إنهاء الجلسة" : "End session"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-center text-xs text-[#ff9b8e]">{error}</p>}
      {requiresReload && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 w-full text-center text-xs text-[#1DE9B6] underline underline-offset-4"
          data-testid="button-reload-after-pi-timeout"
        >
          إعادة تحميل الصفحة / Reload page
        </button>
      )}
      {sdkStatus === "failed" && (
        <div className="mt-3 text-center">
          <p role="alert" className="text-xs text-[#ff9b8e]">{t("auth.piSignInFailed")}</p>
          <button
            type="button"
            onClick={() => void retrySdkLoad()}
            className="mt-2 text-xs text-[#1DE9B6] underline"
            data-testid="button-retry-pi-sdk"
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      <p className="mt-3 text-center text-xs leading-relaxed text-[#849a8b]">{t("auth.piExistingAccountHint")}</p>
      <PiAuthDiagnosticsPanel
        snapshot={diagnostics}
        redirectInSeconds={redirectInSeconds}
        comparison={comparison}
      />
    </div>
  );
}