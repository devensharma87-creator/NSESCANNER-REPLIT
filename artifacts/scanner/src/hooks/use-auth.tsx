/**
 * AuthContext + useAuth hook. Provides app-wide identity:
 *   - role: "owner" | "subscriber" | null (null = logged out)
 *   - status: subscription status (active for owner, computed for subscriber)
 *   - allowedTabs: the keys the current user can navigate to
 *   - subscriber: the full SubscriberInfo when role === "subscriber"
 *   - refresh(): re-fetch /api/auth/me (call after login/signup/admin actions)
 *
 * Wraps the whole app. The LoginGate consumes this to decide what to render.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchMe, type MeResponse, type AllowedTabKey, type SubscriberInfo, type UserStatus, ALLOWED_TAB_KEYS } from "@/lib/auth-api";

type AuthState =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "owner"; allowedTabs: AllowedTabKey[] }
  | { kind: "subscriber"; subscriber: SubscriberInfo }
  | { kind: "error"; message: string };

interface AuthCtx {
  state: AuthState;
  role: "owner" | "subscriber" | null;
  status: UserStatus | null;
  allowedTabs: AllowedTabKey[];
  subscriber: SubscriberInfo | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me: MeResponse = await fetchMe();
      if (!me.authenticated) {
        setState({ kind: "guest" });
        return;
      }
      if (me.role === "owner") {
        setState({ kind: "owner", allowedTabs: me.allowedTabs });
        return;
      }
      setState({ kind: "subscriber", subscriber: me.user });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Cannot reach server" });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<AuthCtx>(() => {
    const role: AuthCtx["role"] =
      state.kind === "owner" ? "owner" :
      state.kind === "subscriber" ? "subscriber" : null;
    const status: AuthCtx["status"] =
      state.kind === "owner" ? "active" :
      state.kind === "subscriber" ? state.subscriber.status : null;
    const allowedTabs: AllowedTabKey[] =
      state.kind === "owner" ? [...ALLOWED_TAB_KEYS] :
      state.kind === "subscriber" ? state.subscriber.allowedTabs : [];
    const subscriber = state.kind === "subscriber" ? state.subscriber : null;
    return { state, role, status, allowedTabs, subscriber, refresh };
  }, [state, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
