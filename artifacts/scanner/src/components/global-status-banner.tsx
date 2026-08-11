/**
 * GlobalStatusBanner — ONE persistent, app-shell-wide Kite readiness surface.
 *
 * Problem it solves: the per-page KiteOfflineBanner only mounts on 3 pages, so
 * on a Kite-offline day the user sees many half-empty panels across the app and
 * concludes "the site is broken". This banner mounts once in <Layout> and gives
 * a single honest answer to "is live market data available, and if not, why?".
 *
 * VISIBILITY ONLY: it never changes a trading decision. It is OWNER-SCOPED — the
 * readiness endpoint (/api/kite/status) is owner-gated and only the owner can
 * reconnect Kite, so the query is disabled for everyone else and the banner
 * renders nothing for them (fail-open). It is also FAIL-OPEN on loading/error: a
 * phantom warning is worse than a missing one when the status endpoint is flaky.
 *
 * Behaviour (spec PART B.3):
 *   - Full-width banner ONLY for the two critical offline states
 *     (KITE_OFFLINE_PREOPEN, KITE_OFFLINE_MARKET_HOURS).
 *   - Everything else collapses to a small status chip.
 *
 * Chip label nuance (2026-07-01 fix for "Kite live" vs "Yahoo fallback" contradiction):
 *   - KITE_READY + market open + liveQuotes > 0  → "Kite live" (green)
 *   - KITE_READY + market open + liveQuotes = 0  → "Kite — waiting for ticks" (yellow)
 *   - KITE_READY + market closed / pre_open       → "Kite — market closed" (green)
 *   This prevents the topbar showing "Kite live" while scanner uses Yahoo/delayed
 *   data simply because no ticks have arrived yet (liveQuotes = 0 after close).
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, CheckCircle2, Clock, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useMarketCoverage } from "@/components/kite-offline-banner";

export type KiteReadinessState =
  | "KITE_READY"
  | "KITE_EXPIRES_SOON"
  | "KITE_EXPIRED"
  | "KITE_OFFLINE_PREOPEN"
  | "KITE_OFFLINE_MARKET_HOURS"
  | "KITE_CONNECTED_BUT_FEED_STALE";

export type KiteReadinessSeverity = "ok" | "info" | "warn" | "critical";

export interface KiteReadiness {
  state: KiteReadinessState;
  severity: KiteReadinessSeverity;
  sessionPresent: boolean;
  sessionValid: boolean;
  loginTime: string | null;
  expiresAt: string | null;
  kiteOfflineSince: string | null;
  marketSession: "open" | "closed" | "pre_open";
  isPreOpenWindow: boolean;
  feedConnected: boolean;
  feedRunning: boolean;
  userActionRequired: boolean;
  checkedAt: string;
}

interface KiteStatusResponse {
  readiness?: KiteReadiness;
  feed?: { liveQuotes?: number; subscribed?: number };
}

interface KiteReadinessFull {
  readiness: KiteReadiness | null;
  liveQuotes: number;
}

const API_BASE = import.meta.env.BASE_URL; // includes trailing slash

async function fetchKiteReadiness(): Promise<KiteReadinessFull> {
  const r = await fetch(`${API_BASE}api/kite/status`, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as KiteStatusResponse;
  return {
    readiness: j.readiness ?? null,
    liveQuotes: j.feed?.liveQuotes ?? 0,
  };
}

/** Dev-only override: `?mockReadiness=<STATE>` (sticky in sessionStorage) lets
 *  the owner eyeball every banner variant without breaking a real session. */
function getMockReadiness(): KiteReadinessFull | null {
  if (!import.meta.env.DEV) return null;
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("mockReadiness");
    if (fromUrl) {
      if (fromUrl === "off" || fromUrl === "clear") window.sessionStorage.removeItem("mockReadiness");
      else window.sessionStorage.setItem("mockReadiness", fromUrl);
      url.searchParams.delete("mockReadiness");
      window.history.replaceState({}, "", url.toString());
    }
    const key = window.sessionStorage.getItem("mockReadiness");
    if (!key || key === "off" || key === "clear") return null;
    const sevByState: Record<string, KiteReadinessSeverity> = {
      KITE_READY: "ok",
      KITE_EXPIRES_SOON: "info",
      KITE_EXPIRED: "warn",
      KITE_CONNECTED_BUT_FEED_STALE: "warn",
      KITE_OFFLINE_PREOPEN: "critical",
      KITE_OFFLINE_MARKET_HOURS: "critical",
    };
    const sev = sevByState[key];
    if (!sev) return null;
    const now = new Date();
    return {
      readiness: {
        state: key as KiteReadinessState,
        severity: sev,
        sessionPresent: true,
        sessionValid: key === "KITE_READY" || key === "KITE_EXPIRES_SOON" || key === "KITE_CONNECTED_BUT_FEED_STALE",
        loginTime: new Date(now.getTime() - 6 * 3600_000).toISOString(),
        expiresAt: new Date(now.getTime() + 2 * 3600_000).toISOString(),
        kiteOfflineSince: sev === "critical" || key === "KITE_EXPIRED" ? new Date(now.getTime() - 90 * 60_000).toISOString() : null,
        marketSession: key === "KITE_OFFLINE_MARKET_HOURS" || key === "KITE_CONNECTED_BUT_FEED_STALE" ? "open" : key === "KITE_OFFLINE_PREOPEN" ? "pre_open" : "closed",
        isPreOpenWindow: key === "KITE_OFFLINE_PREOPEN",
        feedConnected: key === "KITE_READY" || key === "KITE_EXPIRES_SOON",
        feedRunning: key !== "KITE_OFFLINE_MARKET_HOURS" && key !== "KITE_OFFLINE_PREOPEN",
        userActionRequired: sev === "critical" || key === "KITE_EXPIRED",
        checkedAt: now.toISOString(),
      },
      liveQuotes: key === "KITE_READY" ? 3 : 0,
    };
  } catch {
    return null;
  }
}

export type BannerMode = "full" | "chip" | "hidden";

export interface BannerView {
  mode: BannerMode;
  tone: KiteReadinessSeverity;
  headline: string;
  impact: string;
  chipLabel: string;
  showReconnect: boolean;
}

const PREOPEN_COPY =
  "Kite session is offline. Reconnect before market open to enable live data, F&O signals, charts, watchlist, scanner, and paper trading.";
const MARKET_HOURS_COPY =
  "Kite live data is offline. Trade-grade Indian data, F&O signals, charts, watchlist prices, and paper-trading execution are degraded or unavailable.";
const FEED_STALE_COPY =
  "Kite session is valid but the live feed is disconnected. Prices may be delayed until the feed reconnects.";

/**
 * PURE banner-view deriver — unit-tested. Full banner reserved for the two
 * critical offline states; all else is a chip toned by severity.
 *
 * @param r         The KiteReadiness from /api/kite/status (null → hidden / fail-open).
 * @param liveQuotes Feed live-quote count from /api/kite/status feed.liveQuotes.
 *                  Pass undefined to use legacy behaviour (no quote-count nuance).
 */
/**
 * Phase 0.5B — the minimum coverage facts the chip needs to stay honest.
 * Kept structural (not an import of the full contract) so this module has no
 * new dependency and legacy 2-argument callers keep compiling.
 */
export interface BannerCoverage {
  overallState: string;
  freshInstrumentCount: number;
  requiredInstrumentCount: number;
}

export function deriveBannerView(
  r: KiteReadiness | null | undefined,
  liveQuotes?: number,
  coverage?: BannerCoverage | null,
): BannerView {
  if (!r) {
    return { mode: "hidden", tone: "ok", headline: "", impact: "", chipLabel: "", showReconnect: false };
  }
  switch (r.state) {
    case "KITE_OFFLINE_PREOPEN":
      return { mode: "full", tone: "critical", headline: "Kite offline — reconnect before market open", impact: PREOPEN_COPY, chipLabel: "Kite offline", showReconnect: true };
    case "KITE_OFFLINE_MARKET_HOURS":
      return { mode: "full", tone: "critical", headline: "Kite live data offline", impact: MARKET_HOURS_COPY, chipLabel: "Kite offline", showReconnect: true };
    case "KITE_CONNECTED_BUT_FEED_STALE":
      return { mode: "chip", tone: "warn", headline: "Kite feed disconnected", impact: FEED_STALE_COPY, chipLabel: "Kite feed disconnected", showReconnect: false };
    case "KITE_EXPIRED":
      return { mode: "chip", tone: "warn", headline: "Kite session expired", impact: "Kite session expired — reconnect to restore live data.", chipLabel: "Kite session expired", showReconnect: true };
    case "KITE_EXPIRES_SOON":
      return { mode: "chip", tone: "info", headline: "Kite session expires soon", impact: "Kite session expires soon.", chipLabel: "Kite expires soon", showReconnect: false };
    case "KITE_READY":
    default: {
      // Nuanced chip label based on market session and live quote count.
      // When liveQuotes is undefined (legacy / unknown), fall back to "Kite live".
      if (liveQuotes !== undefined) {
        if (r.marketSession === "closed" || r.marketSession === "pre_open") {
          // This chip is a claim about the SESSION, not about data coverage —
          // hence it stays green for the expected after-hours case. But an
          // integrity fault does not stop mattering because the market shut,
          // so conflicted quotes and unresolved token rotations still warn.
          const integrityFault =
            coverage?.overallState === "CONFLICTED" ||
            coverage?.overallState === "RECONCILIATION_PENDING";
          return {
            mode: "chip",
            tone: integrityFault ? "warn" : "ok",
            headline: integrityFault
              ? "Kite session active — data integrity issue"
              : "Kite session active — market closed",
            impact: integrityFault
              ? `Market is closed, but market-data coverage reports ${coverage?.overallState}. Stored prices may be wrong or misattributed until this resolves.`
              : coverage
                ? `Kite session is active. Market is closed — live ticks are not expected. Coverage state: ${coverage.overallState} (${coverage.freshInstrumentCount}/${coverage.requiredInstrumentCount} configured instruments carry a current value).`
                : "Kite session is active. Market is closed — live ticks are not expected.",
            chipLabel: integrityFault ? "Kite — data integrity issue" : "Kite — market closed",
            showReconnect: false,
          };
        }
        if (r.marketSession === "open" && liveQuotes === 0) {
          return {
            mode: "chip",
            tone: "warn",
            headline: "Kite session active — waiting for ticks",
            impact: "Kite session and WebSocket are active but no live ticks have arrived yet. Scanner may show delayed data.",
            chipLabel: "Kite — waiting for ticks",
            showReconnect: false,
          };
        }
      }
      // Phase 0.5B: a bare "Kite live" chip claims whole-market live coverage
      // off nothing more than a non-zero quote count. When real coverage is
      // available and is not LIVE_COMPLETE, say so — and say how much.
      if (coverage && coverage.overallState !== "LIVE_COMPLETE") {
        return {
          mode: "chip",
          tone: "info",
          headline: "Kite live — partial coverage",
          impact: `Live Kite ticks for ${coverage.freshInstrumentCount} of ${coverage.requiredInstrumentCount} configured instruments (${coverage.overallState}). This is not whole-market coverage.`,
          chipLabel: `Kite live — ${coverage.freshInstrumentCount}/${coverage.requiredInstrumentCount}`,
          showReconnect: false,
        };
      }
      return { mode: "chip", tone: "ok", headline: "Kite live", impact: "Live Kite data streaming.", chipLabel: "Kite live", showReconnect: false };
    }
  }
}

function fmtIst(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

async function reconnectKite(): Promise<void> {
  try {
    const r = await fetch(`${API_BASE}api/kite/login-url`, { credentials: "include" });
    if (r.ok) {
      const j = (await r.json()) as { url?: string };
      if (j?.url) {
        window.location.href = j.url;
        return;
      }
    }
  } catch {
    /* fall through to the Kite settings page */
  }
  window.location.href = `${API_BASE}kite`;
}

const TONE_BANNER: Record<KiteReadinessSeverity, string> = {
  critical: "border-red-500/50 bg-red-500/10 text-red-100",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  info: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
};

const TONE_CHIP: Record<KiteReadinessSeverity, string> = {
  critical: "border-red-500/50 bg-red-500/10 text-red-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  info: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

/**
 * Shared readiness hook — single source of truth for Kite readiness across the
 * app shell (GlobalStatusBanner) and the F&O page's per-index diagnostics. The
 * react-query key is shared so both consumers dedupe to one network request.
 * Owner-scoped + fail-open (returns null for non-owners and on loading/error).
 */
export function useKiteReadiness(): KiteReadiness | null {
  const { role } = useAuth();
  const isOwner = role === "owner";
  const mock = getMockReadiness();

  const q = useQuery({
    queryKey: ["kite-readiness"],
    queryFn: fetchKiteReadiness,
    refetchInterval: mock ? false : 60_000,
    refetchOnWindowFocus: !mock,
    staleTime: 30_000,
    retry: 1,
    // Owner-only: the readiness endpoint is owner-gated; skip the request (and
    // the 401 noise) entirely for public/subscriber sessions.
    enabled: isOwner && !mock,
  });

  const full = mock ?? (isOwner ? q.data ?? null : null);
  return full?.readiness ?? null;
}

/** Full Kite status including live-quote count — used by GlobalStatusBanner. */
function useKiteReadinessFull(): KiteReadinessFull | null {
  const { role } = useAuth();
  const isOwner = role === "owner";
  const mock = getMockReadiness();

  const q = useQuery({
    queryKey: ["kite-readiness"],
    queryFn: fetchKiteReadiness,
    refetchInterval: mock ? false : 60_000,
    refetchOnWindowFocus: !mock,
    staleTime: 30_000,
    retry: 1,
    enabled: isOwner && !mock,
  });

  return mock ?? (isOwner ? q.data ?? null : null);
}

// ── DATA_DEGRADED hook — consumes GET /api/data-health/global ─────────────────

interface GlobalDataHealthSummary {
  overallStatus: string;
  severity: string;
  badge: string;
  headline: string;
}

async function fetchGlobalDataHealth(): Promise<GlobalDataHealthSummary> {
  const r = await fetch(`${API_BASE}api/data-health/global`, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as GlobalDataHealthSummary;
}

/**
 * Owner-only hook for the global data health summary. Returns null for
 * non-owners and on loading/error (fail-open — never show a phantom warning).
 * Shares the 60-second polling interval with the Kite readiness hook.
 */
function useGlobalDataHealth(): GlobalDataHealthSummary | null {
  const { role } = useAuth();
  const isOwner = role === "owner";

  const q = useQuery({
    queryKey: ["global-data-health"],
    queryFn: fetchGlobalDataHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
    enabled: isOwner,
  });

  return isOwner ? q.data ?? null : null;
}

export function GlobalStatusBanner() {
  const full = useKiteReadinessFull();
  const globalHealth = useGlobalDataHealth();
  // Public coverage facts. Shares the banner's react-query key, so this adds
  // no extra request. Non-owners get it too — the chip must be honest for
  // everyone, not just the owner.
  const coverage = useMarketCoverage();
  const view = deriveBannerView(full?.readiness, full?.liveQuotes, coverage);

  // DATA_DEGRADED chip: shown when Kite session looks ok (green chip) but the
  // global backbone health reports that some modules are blocked.
  // Suppressed whenever the Kite state already shows a more specific warning/critical
  // (the Kite banner already tells the owner something is wrong in those cases).
  const showDegradedChip =
    globalHealth?.overallStatus === "DEGRADED_DATA" &&
    view.mode === "chip" &&
    view.tone === "ok";

  if (!full?.readiness || view.mode === "hidden") return null;

  if (view.mode === "chip") {
    const Icon = view.tone === "ok" ? CheckCircle2 : view.tone === "info" ? Clock : AlertTriangle;
    return (
      <div className="w-full flex justify-end gap-2 px-4 py-1" data-testid="global-status-chip">
        {/* DATA_DEGRADED chip — rendered alongside the green Kite chip when
            the global backbone reports blocked modules despite a valid session. */}
        {showDegradedChip && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/40 bg-orange-500/10 text-orange-300 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            title={globalHealth?.headline ?? "Some modules are blocked — certain pages may show delayed or cached data."}
            data-testid="global-status-chip-degraded"
          >
            <ShieldAlert className="h-3 w-3" />
            {globalHealth?.badge ?? "DATA DEGRADED"}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TONE_CHIP[view.tone]}`}
          title={view.impact}
          data-testid={`global-status-chip-${view.tone}`}
        >
          <Icon className="h-3 w-3" />
          {view.chipLabel}
          {view.showReconnect && (
            <button
              type="button"
              onClick={reconnectKite}
              className="ml-1 underline underline-offset-2 hover:opacity-80"
              data-testid="chip-reconnect-kite"
            >
              Reconnect
            </button>
          )}
        </span>
      </div>
    );
  }

  // Full critical banner.
  return (
    <div
      className={`w-full border-b px-4 py-2.5 flex items-start gap-3 text-xs ${TONE_BANNER[view.tone]}`}
      role="alert"
      data-testid="global-status-banner"
      data-state={full.readiness.state}
    >
      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-mono font-bold uppercase tracking-wider">{view.headline}</div>
        <div className="text-[11px] leading-snug opacity-90">{view.impact}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] font-mono opacity-75 pt-0.5">
          <span>Last login: {fmtIst(full.readiness.loginTime)}</span>
          <span>Expires: {fmtIst(full.readiness.expiresAt)}</span>
          <span>Offline since: {fmtIst(full.readiness.kiteOfflineSince)}</span>
          <span>Feed: {full.readiness.feedConnected ? "connected" : full.readiness.feedRunning ? "running (not connected)" : "stopped"}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={reconnectKite}
        className="shrink-0 inline-flex items-center gap-1 rounded border border-current/50 bg-current/10 hover:opacity-80 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-opacity"
        data-testid="banner-reconnect-kite"
      >
        <RefreshCw className="h-3 w-3" />
        Reconnect Kite
      </button>
    </div>
  );
}
