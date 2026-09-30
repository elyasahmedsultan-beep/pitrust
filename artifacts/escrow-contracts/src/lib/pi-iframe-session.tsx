import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setAdditionalHeadersGetter, setAuthTokenGetter } from "@workspace/api-client-react";
import { getPiAppAccessToken } from "@/lib/pi-app-session";

export type PiIframeIdentity = {
  uid: string;
  username: string | null;
};

export type PiIframeIdentitySession = {
  token: string;
  expiresAt: string;
  identity: PiIframeIdentity;
};

type PiIframeSessionContextValue = {
  session: PiIframeIdentitySession | null;
  setSession: (session: PiIframeIdentitySession) => void;
  clearSession: () => Promise<void>;
  setAdminSessionToken: (token: string | null) => void;
};

const PiIframeSessionContext = createContext<PiIframeSessionContextValue | null>(null);
let activeSession: PiIframeIdentitySession | null = null;
let activeAdminSessionToken: string | null = null;

export function getPiIframeSessionToken(): string | null {
  if (!activeSession) return null;
  const expiresAt = Date.parse(activeSession.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return activeSession.token;
}

function getPiIframeAdminHeaders(): HeadersInit | null {
  if (!getPiIframeSessionToken() || !activeAdminSessionToken) return null;
  return { "x-pactline-admin-session": activeAdminSessionToken };
}

export function PiIframeSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSessionState] = useState<PiIframeIdentitySession | null>(null);
  const setSession = useCallback((next: PiIframeIdentitySession) => {
    queryClient.clear();
    activeSession = next;
    activeAdminSessionToken = null;
    setSessionState(next);
  }, [queryClient]);
  const setAdminSessionToken = useCallback((token: string | null) => {
    activeAdminSessionToken = token;
  }, []);
  const clearSession = useCallback(async () => {
    const token = getPiIframeSessionToken();
    activeSession = null;
    activeAdminSessionToken = null;
    setSessionState(null);
    queryClient.clear();
    if (!token) return;

    const apiBase = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}api/`;
    await fetch(`${apiBase}pi/iframe-session`, {
      method: "DELETE",
      credentials: "omit",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }, [queryClient]);

  setAuthTokenGetter(() => getPiIframeSessionToken() ?? getPiAppAccessToken());
  setAdditionalHeadersGetter(getPiIframeAdminHeaders);

  useEffect(() => {
    if (!session) return;
    const expiresAt = Date.parse(session.expiresAt);
    const remainingMs = expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || remainingMs <= 0) {
      void clearSession();
      return;
    }
    const timeout = window.setTimeout(() => void clearSession(), remainingMs);
    return () => window.clearTimeout(timeout);
  }, [session, clearSession]);

  const value = useMemo(
    () => ({ session, setSession, clearSession, setAdminSessionToken }),
    [session, setSession, clearSession, setAdminSessionToken],
  );

  return (
    <PiIframeSessionContext.Provider value={value}>
      {children}
    </PiIframeSessionContext.Provider>
  );
}

export function piIframeAuthorizationHeaders(): Record<string, string> {
  const token = getPiIframeSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function usePiIframeSession(): PiIframeSessionContextValue {
  const context = useContext(PiIframeSessionContext);
  if (!context) {
    throw new Error("usePiIframeSession must be used inside PiIframeSessionProvider");
  }
  return context;
}