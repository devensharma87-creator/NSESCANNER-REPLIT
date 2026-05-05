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
  | { kind: "guest"; publicMode: boolean }
  | { kind: "owner"; allowedTabs: AllowedTabKey[]; publicMode: boolean }
  | { kind: "subscriber"; subscriber: SubscriberInfo; publicMode: boolean }
  | { kind: "error"; message: string };

interface AuthCtx {
  state: AuthState;
  role: "owner" | "subscriber" | null;
  status: UserStatus | null;
  allowedTabs: AllowedTabKey[];
  subscriber: SubscriberInfo | null;
  /** True iff owner has flipped on public-access mode. When true the
   *  whole site renders for any visitor (no cookie required) and the
   *  amber relock banner is shown. */
  publicMode: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me: MeResponse = await fetchMe();
      const publicMode = me.publicMode === true;
      if (!me.authenticated) {
        setState({ kind: "guest", publicMode });
        return;
      }
      if (me.role === "owner") {
        setState({ kind: "owner", allowedTabs: me.allowedTabs, publicMode });
        return;
      }
      setState({ kind: "subscriber", subscriber: me.user, publicMode });
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
    const publicMode =
      state.kind === "guest" || state.kind === "owner" || state.kind === "subscriber"
        ? state.publicMode
        : false;
    return { state, role, status, allowedTabs, subscriber, publicMode, refresh };
  }, [state, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
