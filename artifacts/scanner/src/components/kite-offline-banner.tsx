/**
 * KiteOfflineBanner / KiteOfflineNote — slim UX surfaces that appear on
 * data-sensitive pages (Scanner, Stock Detail, Deep Scan, Statements) to
 * explain the current data-source state.
 *
 * Backed by GET /api/data-health/market (PUBLIC — no auth required, no
 * secrets). Polled every 60 s by ONE source of truth (`useMarketDataHealth`)
 * so multiple mounted components share a single in-flight request.
 *
 * KEY BEHAVIOUR CHANGE (2026-07-01):
 *   Previously used GET /api/provider/status which returned active="yahoo"
 *   whenever liveQuotes=0 — even after market close when that is EXPECTED.
 *   This caused the contradictory "KITE LIVE" topbar + "Live Zerodha feed
 *   unavailable" scanner banner after 15:30 IST.
 *
 *   Now uses the canonical MarketDataHealth contract:
 *   - LIVE_TICKS               → banner hidden (all good)
 *   - MARKET_CLOSED_SESSION_ACTIVE → banner hidden (expected after-hours)
 *   - CONNECTED_WAITING        → info banner (session active, ticks warming up)
 *   - STALE                    → amber banner (WebSocket reconnecting)
 *   - UNAVAILABLE              → amber banner (session expired / missing)
 *
 * Both surfaces are FAIL-OPEN: silent on loading / error. A phantom warning
 * is worse than a missing one when the status endpoint is flaky.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Info, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

type QuoteStatus =
  | "LIVE_TICKS"
  | "CONNECTED_WAITING"
  | "MARKET_CLOSED_SESSION_ACTIVE"
  | "STALE"
  | "UNAVAILABLE";

type MarketDataHealthPublic = {
  marketSession: "open" | "closed" | "pre_open";
  kite: {
    sessionStatus: "ACTIVE" | "EXPIRED" | "MISSING";
    quoteStatus: QuoteStatus;
    explanation: string;
  };
  overall: {
    badge: string;
    severity: "green" | "yellow" | "orange" | "red";
    userMessage: string;
    actionRequired: boolean;
    action: string | null;
  };
};

const DATA_HEALTH_KEY = ["data-health-market"] as const;
const API_PATH = "/api/data-health/market";

async function fetchMarketDataHealth(): Promise<MarketDataHealthPublic> {
  const r = await fetch(API_PATH, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<MarketDataHealthPublic>;
}

/**
 * Dev-only override: `?mockProvider=<key>` (sticky in sessionStorage) lets
 * the owner eyeball every banner variant without breaking a real session.
 *
 * Keys:
 *   session        → "UNAVAILABLE" (session expired)
 *   disconnected   → "STALE" (WebSocket stopped)
 *   waiting        → "CONNECTED_WAITING" (warming up)
 *   market_closed  → "MARKET_CLOSED_SESSION_ACTIVE" (banner should hide)
 *   kite           → "LIVE_TICKS" (banner should hide)
 *   off / clear    → remove override and resume real polling
 */
export function getMockProviderStatus(): MarketDataHealthPublic | null {
  if (!import.meta.env.DEV) return null;
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("mockProvider");
    if (fromUrl) {
      if (fromUrl === "off" || fromUrl === "clear") {
        window.sessionStorage.removeItem("mockProvider");
      } else {
        window.sessionStorage.setItem("mockProvider", fromUrl);
      }
      url.searchParams.delete("mockProvider");
      window.history.replaceState({}, "", url.toString());
    }
    const key = window.sessionStorage.getItem("mockProvider");
    if (!key || key === "off" || key === "clear") return null;

    const MOCK: Record<string, MarketDataHealthPublic> = {
      session: {
        marketSession: "open",
        kite: { sessionStatus: "EXPIRED", quoteStatus: "UNAVAILABLE", explanation: "Kite session has expired — complete Zerodha daily login." },
        overall: { badge: "KITE LOGIN REQUIRED", severity: "red", userMessage: "Session expired — scanner on delayed Yahoo Finance data.", actionRequired: true, action: "/kite" },
      },
      disconnected: {
        marketSession: "open",
        kite: { sessionStatus: "ACTIVE", quoteStatus: "STALE", explanation: "Session active but WebSocket feed has stopped." },
        overall: { badge: "KITE STALE — RECONNECTING", severity: "orange", userMessage: "WebSocket feed disconnected — data may be stale.", actionRequired: false, action: null },
      },
      waiting: {
        marketSession: "open",
        kite: { sessionStatus: "ACTIVE", quoteStatus: "CONNECTED_WAITING", explanation: "Session active, WebSocket connected — waiting for first tick." },
        overall: { badge: "KITE SESSION ACTIVE — WAITING FOR TICKS", severity: "yellow", userMessage: "Kite session active, warming up — scanner may show cached data.", actionRequired: false, action: null },
      },
      market_closed: {
        marketSession: "closed",
        kite: { sessionStatus: "ACTIVE", quoteStatus: "MARKET_CLOSED_SESSION_ACTIVE", explanation: "Market closed — session active and ready." },
        overall: { badge: "KITE SESSION ACTIVE — MARKET CLOSED", severity: "green", userMessage: "Market closed — data from last session.", actionRequired: false, action: null },
      },
      kite: {
        marketSession: "open",
        kite: { sessionStatus: "ACTIVE", quoteStatus: "LIVE_TICKS", explanation: "Live Kite ticks streaming." },
        overall: { badge: "KITE LIVE", severity: "green", userMessage: "Live Kite data streaming.", actionRequired: false, action: null },
      },
    };
    return MOCK[key] ?? null;
  } catch {
    return null;
  }
}

/**
 * Single source of truth — pass pollMs=null for a pure cache reader (no timer
 * of its own). Exactly one observer in the tree should pass pollMs > 0.
 */
function useMarketDataHealth(pollMs: number | null) {
  const mock = getMockProviderStatus();
  const q = useQuery({
    queryKey: DATA_HEALTH_KEY,
    queryFn: fetchMarketDataHealth,
    refetchInterval: mock ? false : (pollMs ?? false),
    refetchOnWindowFocus: !mock && pollMs != null,
    staleTime: 30_000,
    retry: 1,
    enabled: !mock,
  });
  if (mock) {
    return { data: mock, isLoading: false, isError: false } as const;
  }
  return q;
}

/** Returns true if the banner should be shown for this quoteStatus. */
function shouldShowBanner(quoteStatus: QuoteStatus): boolean {
  return quoteStatus === "UNAVAILABLE" || quoteStatus === "STALE" || quoteStatus === "CONNECTED_WAITING";
}

/**
 * Full-width page-level banner. Shows an honest explanation of the current
 * data-source state when Kite is offline, stale, or still warming up.
 * Hides silently when data is live (LIVE_TICKS) or market is closed with a
 * valid session (MARKET_CLOSED_SESSION_ACTIVE — this is the normal state
 * after 15:30 IST and should NOT raise an alarm).
 */
export function KiteOfflineBanner() {
  const { role } = useAuth();
  const isOwner = role === "owner";
  const { data, isLoading, isError } = useMarketDataHealth(60_000);

  if (isLoading || isError || !data) return null;
  if (!shouldShowBanner(data.kite.quoteStatus)) return null;

  const quoteStatus = data.kite.quoteStatus;
  const isInfo = quoteStatus === "CONNECTED_WAITING";
  const Icon = isInfo ? Info : AlertTriangle;
  const borderCls = isInfo
    ? "border-blue-500/40 bg-blue-500/10 text-blue-100"
    : "border-amber-500/40 bg-amber-500/10 text-amber-100";
  const iconCls = isInfo ? "text-blue-400" : "text-amber-400";
  const headlineCls = isInfo ? "text-blue-300" : "text-amber-300";

  const headline =
    quoteStatus === "UNAVAILABLE"
      ? data.kite.sessionStatus === "EXPIRED"
        ? "Kite session expired — please reconnect"
        : data.kite.sessionStatus === "MISSING"
          ? "Kite API credentials not configured"
          : "Live Zerodha feed unavailable"
      : quoteStatus === "STALE"
        ? "Kite WebSocket feed stopped — reconnecting"
        : "Kite session active — waiting for first tick";

  const body =
    quoteStatus === "UNAVAILABLE"
      ? "Scanner is using delayed Yahoo Finance data (~15 min delayed). Not trade-grade — signals and paper trading are blocked. Reconnect to restore live data."
      : quoteStatus === "STALE"
        ? "Kite session is valid but the WebSocket feed has disconnected. Data may be stale. Feed will attempt to reconnect automatically."
        : "Kite session and WebSocket are connected. The scanner will switch to live Kite data as soon as the first ticks arrive. Previously cached data is shown in the meantime.";

  return (
    <div
      className={`rounded-md border px-3 py-2 flex items-start gap-2 text-xs ${borderCls}`}
      data-testid="kite-offline-banner"
      data-quote-status={quoteStatus}
      role="status"
    >
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconCls}`} />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className={`font-mono font-semibold uppercase tracking-wider ${headlineCls}`}>
          {headline}
        </div>
        <div className="text-[11px] leading-snug opacity-90">
          {body}
        </div>
        {data.kite.explanation && (
          <div className="text-[10px] opacity-60 font-mono mt-0.5">
            {data.kite.explanation}
          </div>
        )}
      </div>
      {isOwner && quoteStatus === "UNAVAILABLE" && (
        <Link
          href="/kite"
          className="shrink-0 inline-flex items-center gap-1 rounded border border-amber-400/50 bg-amber-500/20 hover:bg-amber-500/30 hover:text-amber-50 px-2 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors"
          data-testid="link-kite-reconnect"
        >
          Reconnect Zerodha
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

/**
 * Inline slim variant. Pure cache reader (no polling timer of its own).
 * Drop into any data-sparse section; renders nothing on loading / error /
 * live / market-closed-session-active.
 */
export function KiteOfflineNote({
  area = "this section",
}: { area?: string }) {
  const { data, isLoading, isError } = useMarketDataHealth(null);
  if (isLoading || isError || !data) return null;
  if (!shouldShowBanner(data.kite.quoteStatus)) return null;
  const label =
    data.kite.quoteStatus === "UNAVAILABLE"
      ? "Limited data — Zerodha Kite session is offline."
      : data.kite.quoteStatus === "CONNECTED_WAITING"
        ? "Kite session active — live ticks warming up."
        : "Kite feed reconnecting — data may be stale.";
  return (
    <div
      className="rounded border border-amber-500/30 bg-amber-500/5 text-amber-200 px-2 py-1.5 text-[11px] font-mono leading-snug flex items-start gap-1.5"
      data-testid="kite-offline-note"
    >
      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-400" />
      <span>
        {label} Limited data in {area}.{" "}
        {data.kite.quoteStatus === "UNAVAILABLE" && "Reconnect to restore full coverage."}
      </span>
    </div>
  );
}

/**
 * Compatibility shim: headlineFor is no longer used internally but kept so
 * external callers (if any) continue to compile without changes.
 * @deprecated Use useMarketDataHealth and the quoteStatus field directly.
 */
export function headlineFor(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("complete kite daily login") || r.includes("session"))
    return "Kite session expired — please re-login";
  if (r.includes("kite_api_key") || r.includes("kite_api_secret"))
    return "Kite API credentials not configured";
  if (r.includes("disconnected"))
    return "Kite WebSocket disconnected — falling back to Yahoo";
  return "Live Zerodha feed unavailable — using delayed Yahoo data";
}
