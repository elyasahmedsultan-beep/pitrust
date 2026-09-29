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

export type PiAppSessionState = {
  loading: boolean;
  signedIn: boolean;
  accountId: string | null;
  piUid: string | null;
  username: string | null;
  refresh: () => Promise<boolean>;
  signOut: () => Promise<void>;
};

type SessionResponse =
  | { authenticated: true; accountId: string; piUid: string; username: string | null }
  | { authenticated: false };

const Context = createContext<PiAppSessionState | null>(null);

function sessionUrl() {
  return `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}api/pi/session`;
}

export function PiAppSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Extract<SessionResponse, { authenticated: true }> | null>(null);
  const observedAccountId = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(sessionUrl(), {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Pi app session lookup failed");
      const payload = await response.json() as SessionResponse;
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

  const signOut = useCallback(async () => {
    try {
      await fetch(sessionUrl(), {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      });
    } finally {
      observedAccountId.current = null;
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
    refresh,
    signOut,
  }), [loading, refresh, session, signOut]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePiAppSession(): PiAppSessionState {
  const context = useContext(Context);
  if (!context) throw new Error("usePiAppSession must be used inside PiAppSessionProvider");
  return context;
}
