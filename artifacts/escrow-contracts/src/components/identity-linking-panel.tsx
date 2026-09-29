import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { Link2, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n";
import { initializePiSdk } from "@/lib/pi-sdk";
import { piIframeAuthorizationHeaders, usePiIframeSession } from "@/lib/pi-iframe-session";
import { usePiAppSession } from "@/lib/pi-app-session";

type PiStatus = { linked: boolean };

export function IdentityLinkingPanel() {
  const { t } = useI18n();
  const { isLoaded, user } = useUser();
  const { session: piSession } = usePiIframeSession();
  const piAppSession = usePiAppSession();
  const [piLinked, setPiLinked] = useState<boolean | null>(null);
  const [piStatusFailed, setPiStatusFailed] = useState(false);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [busy, setBusy] = useState<"pi" | "google" | null>(null);
  const [error, setError] = useState("");

  const clerkMatchesPiAccount = !piAppSession.signedIn ||
    !user ||
    piAppSession.accountId === user.id;
  const canManageGoogle = Boolean(user && clerkMatchesPiAccount);
  const googleLinked = canManageGoogle && (user?.externalAccounts.some(
    (account) => account.provider === "google",
  ) ?? false);

  useEffect(() => {
    let active = true;
    if (!isLoaded) return () => { active = false; };
    if (!user && !piSession && !piAppSession.signedIn) {
      setPiLinked(null);
      setPiStatusFailed(false);
      return () => { active = false; };
    }

    const loadStatus = async () => {
      setPiStatusFailed(false);
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}api/pi/status`,
          {
            credentials: "include",
            headers: piIframeAuthorizationHeaders(),
          },
        );
        if (!response.ok) throw new Error("Pi status request failed");
        const status = await response.json() as PiStatus;
        if (active) setPiLinked(status.linked === true);
      } catch {
        if (active) {
          setPiLinked(null);
          setPiStatusFailed(true);
        }
      }
    };
    void loadStatus();
    return () => { active = false; };
  }, [isLoaded, statusRefresh, user?.id, piSession?.token, piAppSession.accountId, piAppSession.signedIn]);

  const linkPi = async () => {
    if (!user || busy || piLinked) return;
    setBusy("pi");
    setError("");
    try {
      const pi = await initializePiSdk();
      const auth = await pi.authenticate(["username"], () => {});
      if (!auth?.accessToken) throw new Error("Pi authentication is unavailable");
      const response = await fetch(
        `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}api/pi/link`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: auth.accessToken }),
        },
      );
      if (!response.ok) {
        if (response.status === 409) throw new Error(t("auth.identityConflict"));
        throw new Error(t("auth.piLinkFailed"));
      }
      setPiLinked(true);
      setPiStatusFailed(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === t("auth.identityConflict")
        ? cause.message
        : t("auth.piLinkFailed"));
    } finally {
      setBusy(null);
    }
  };

  const linkGoogle = async () => {
    if (!user || !canManageGoogle || busy || googleLinked) return;
    setBusy("google");
    setError("");
    try {
      const basePath = import.meta.env.BASE_URL.replace(/\/?$/, "/");
      await user.createExternalAccount({
        strategy: "oauth_google",
        redirectUrl: `${window.location.origin}${basePath}sso-callback`,
      });
    } catch {
      setError(t("auth.googleLinkFailed"));
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-[#324037] bg-[#1A1A1A] p-6">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#193629] text-[#1DE9B6]">
          <Link2 size={19} />
        </div>
        <div>
          <h2 className="font-['Syne'] text-xl">{t("auth.signInMethods")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#9ba99e]">{t("auth.signInMethodsDescription")}</p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#303d34] bg-[#111513] p-3">
          <div className="flex items-center gap-3 text-sm">
            <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-[#1DE9B6] font-['Syne'] font-bold text-[#07130B]">π</span>
            {piLinked ? t("auth.piLinked") : t("auth.piNetwork")}
          </div>
          {piLinked
            ? <ShieldCheck size={18} className="shrink-0 text-[#1DE9B6]" aria-label={t("auth.piLinked")} />
            : <button
                type="button"
                onClick={() => void linkPi()}
                disabled={!isLoaded || !user || piLinked === null || busy !== null}
                className="shrink-0 rounded-md bg-[#00C853] px-3 py-2 text-xs font-bold text-[#08150d] disabled:opacity-60"
                data-testid="button-link-pi"
              >
                {busy === "pi" ? t("auth.connecting") : t("auth.connect")}
              </button>}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#303d34] bg-[#111513] p-3">
          <div className="flex items-center gap-3 text-sm">
            <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-white font-bold text-[#4285F4]">G</span>
            {googleLinked ? t("auth.googleLinked") : t("auth.google")}
          </div>
          {googleLinked
            ? <ShieldCheck size={18} className="shrink-0 text-[#1DE9B6]" aria-label={t("auth.googleLinked")} />
            : <button
                type="button"
                onClick={() => void linkGoogle()}
                disabled={!isLoaded || !canManageGoogle || busy !== null}
                className="shrink-0 rounded-md border border-[#536459] px-3 py-2 text-xs font-semibold text-[#e4eee7] hover:border-[#1DE9B6] disabled:opacity-60"
                data-testid="button-link-google"
              >
                {busy === "google" ? t("auth.connecting") : t("auth.connect")}
              </button>}
        </div>
      </div>
      {piStatusFailed && (
        <p className="mt-3 text-xs text-[#ff9b8e]">
          {t("errors.network")}{" "}
          <button
            type="button"
            onClick={() => setStatusRefresh((value) => value + 1)}
            className="text-[#1DE9B6] underline"
            data-testid="button-retry-pi-status"
          >
            {t("common.retry")}
          </button>
        </p>
      )}
      {error && <p role="alert" className="mt-4 text-xs text-[#ff9b8e]">{error}</p>}
      <p className="mt-4 text-xs leading-relaxed text-[#74877b]">{t("auth.identitySafetyNote")}</p>
    </section>
  );
}