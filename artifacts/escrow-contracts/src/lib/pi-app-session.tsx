import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

export type AuthenticatedPiAppSession = {
  authenticated: true;
  accountId: string;
  piUid: string;
  username: string | null;
  existingAccount?: boolean;
};

export type PiAppSessionState = {
  loading: boolean;
  signedIn: boolean;
  accountId: string | null;
  piUid: string | null;
  username: string | null;
  accept: (session: AuthenticatedPiAppSession) => void;
  refresh: () => Promise<boolean>;
  signOut: () => Promise<void>;
};

type SessionResponse = AuthenticatedPiAppSession | { authenticated: false };

const Context = createContext<PiAppSessionState | null>(null);
let activePiAccessToken: string | null = null;

export function getPiAppAccessToken(): string | null {
  return activePiAccessToken;
}

export function clearPiAppAccessToken(): void {
  activePiAccessToken = null;
}

export function setPiAppAccessToken(token: string | null): void {
  activePiAccessToken = token;
}

export function isAuthenticatedPiAppSession(
  value: unknown,
): value is AuthenticatedPiAppSession {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.authenticated === true &&
    typeof record.accountId === "string" &&
    record.accountId.trim().length > 0 &&
    typeof record.piUid === "string" &&
    record.piUid.trim().length > 0 &&
    (typeof record.username === "string" || record.username === null);
}

function parseSessionResponse(value: unknown): SessionResponse | null {
  if (isAuthenticatedPiAppSession(value)) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).authenticated === false
  ) {
    return { authenticated: false };
  }
  return null;
}

function sessionUrl() {
  return `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}api/pi/session`;
}

export function PiAppSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Extract<SessionResponse, { authenticated: true }> | null>(null);
  const observedAccountId = useRef<string | null | undefined>(undefined);
  const sessionRevision = useRef(0);

  const refresh = useCallback(async () => {
    const requestRevision = sessionRevision.current;
    setLoading(true);
    try {
      const response = await fetch(sessionUrl(), {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Pi app session lookup failed");
      const payload = parseSessionResponse(await response.json());
      if (!payload) throw new Error("Pi app session response was invalid");
      if (requestRevision !== sessionRevision.current) return false;
      const nextSession = payload.authenticated ? payload : null;
      const nextAccountId = nextSession?.accountId ?? null;
      if (
        observedAccountId.current !== undefined &&
        observedAccountId.current !== nextAccountId
      ) {
        queryClient.clear();
      }
      observedAccountId.current = nextAccountId;
      setSession(nextSession);
      return nextSession !== null;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  const accept = useCallback((nextSession: AuthenticatedPiAppSession) => {
    sessionRevision.current += 1;
    if (observedAccountId.current !== nextSession.accountId) {
      queryClient.clear();
    }
    observedAccountId.current = nextSession.accountId;
    setSession(nextSession);
    setLoading(false);
  }, [queryClient]);

  const signOut = useCallback(async () => {
    sessionRevision.current += 1;
    try {
      await fetch(sessionUrl(), {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      });
    } finally {
      observedAccountId.current = null;
      clearPiAppAccessToken();
      setSession(null);
      queryClient.clear();
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<PiAppSessionState>(() => ({
    loading,
    signedIn: session !== null,
    accountId: session?.accountId ?? null,
    piUid: session?.piUid ?? null,
    username: session?.username ?? null,
    accept,
    refresh,
    signOut,
  }), [accept, loading, refresh, session, signOut]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePiAppSession(): PiAppSessionState {
  const context = useContext(Context);
  if (!context) throw new Error("usePiAppSession must be used inside PiAppSessionProvider");
  return context;
}
