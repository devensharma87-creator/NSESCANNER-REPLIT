/**
 * KiteOfflineBanner / KiteOfflineNote — slim amber UX surfaces that appear
 * on data-sensitive pages (Scanner, Stock Detail, Deep Scan, Statements)
 * whenever the Zerodha Kite session is inactive and the server has fallen
 * back to delayed Yahoo data.
 *
 * Backed by GET /api/provider/status (public-readable, mounted in
 * scanner.ts behind only the global requireAuth gate). Polled every 60s
 * by ONE source of truth (`useProviderStatus`) so multiple mounted
 * components don't each create their own interval timer (TanStack Query
 * dedupes in-flight requests by queryKey, but each observer that sets
 * `refetchInterval` adds its own timer — see review 2026-05-13).
 *
 * Both surfaces are FAIL-OPEN: silent on loading / error / live. A phantom
 * warning is worse than a missing one when the status endpoint itself is
 * flaky.
 *
 * Copy is branched by `data.reason` so we don't shout "session expired"
 * at the owner when the actual cause is cold-start, websocket disconnect,
 * or missing credentials.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

type ProviderStatus = {
  active: "kite" | "yahoo";
  liveAvailable: boolean;
  reason: string;
};

async function fetchProviderStatus(): Promise<ProviderStatus> {
  const r = await fetch("/api/provider/status", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<ProviderStatus>;
}

const PROVIDER_STATUS_KEY = ["provider-status"] as const;

/**
 * Dev-only override for banner verification without waiting for a real
 * Kite session expiry. Activated via URL query `?mockProvider=<key>` (sticky
 * in sessionStorage so it survives navigation), or directly via
 * `sessionStorage.setItem('mockProvider', '<key>')` in DevTools.
 *
 * Keys:
 *   session        → "Kite session expired — please re-login"
 *   disconnected   → "Kite WebSocket disconnected — falling back to Yahoo"
 *   no_creds       → "Kite API credentials not configured"
 *   generic        → "Live Zerodha feed unavailable — using delayed Yahoo data"
 *   kite           → live (banner hidden) — useful for clearing the override
 *   off / clear    → remove override and resume real polling
 *
 * No-op outside dev builds. Always returns null in production.
 */
function getMockProviderStatus(): ProviderStatus | null {
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
      // Strip ?mockProvider= from the URL after parsing so it doesn't
      // get accidentally shared in screenshots or pasted links. The
      // sessionStorage entry is now the source of truth.
      url.searchParams.delete("mockProvider");
      window.history.replaceState({}, "", url.toString());
    }
    const key = window.sessionStorage.getItem("mockProvider");
    if (!key || key === "off" || key === "clear") return null;
    switch (key) {
      case "session":
        return { active: "yahoo", liveAvailable: false, reason: "Complete Kite daily login to enable live data" };
      case "disconnected":
        return { active: "yahoo", liveAvailable: false, reason: "Kite WebSocket disconnected" };
      case "no_creds":
        return { active: "yahoo", liveAvailable: false, reason: "KITE_API_KEY / KITE_API_SECRET missing" };
      case "generic":
        return { active: "yahoo", liveAvailable: false, reason: "Live feed warming up" };
      case "kite":
        return { active: "kite", liveAvailable: true, reason: "Live Kite ticks streaming" };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Single source of truth: passing pollMs=null makes this observer a pure
 *  cache reader (no timer of its own). Exactly one observer in the tree
 *  should pass pollMs > 0 — by convention that's the page-level banner.
 *
 *  In dev, a `?mockProvider=<key>` override short-circuits the real fetch
 *  so we can verify all banner copy variants without waiting on real Kite. */
function useProviderStatus(pollMs: number | null) {
  const mock = getMockProviderStatus();
  const q = useQuery({
    queryKey: PROVIDER_STATUS_KEY,
    queryFn: fetchProviderStatus,
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

/** Classify the headline by the textual `reason` returned from
 *  providerStatus(). Defaults to a neutral "Live feed unavailable" so we
 *  don't misdiagnose every yahoo-fallback as a daily-login expiry. */
function headlineFor(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("complete kite daily login") || r.includes("session"))
    return "Kite session expired — please re-login";
  if (r.includes("kite_api_key") || r.includes("kite_api_secret"))
    return "Kite API credentials not configured";
  if (r.includes("disconnected"))
    return "Kite WebSocket disconnected — falling back to Yahoo";
  return "Live Zerodha feed unavailable — using delayed Yahoo data";
}

export function KiteOfflineBanner() {
  const { role } = useAuth();
  const isOwner = role === "owner";
  const { data, isLoading, isError } = useProviderStatus(60_000);

  if (isLoading || isError || !data) return null;
  if (data.active === "kite") return null;

  return (
    <div
      className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-100 px-3 py-2 flex items-start gap-2 text-xs"
      data-testid="kite-offline-banner"
      role="status"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="font-mono font-semibold uppercase tracking-wider text-amber-300">
          {headlineFor(data.reason)}
        </div>
        <div className="text-[11px] leading-snug text-amber-100/90">
          Limited data shown because the Zerodha Kite session is offline.
          Reconnect to restore full fundamentals, Deep Scan, F&amp;O signals,
          and per-stock details.
          {data.reason && (
            <span className="ml-1 opacity-70">({data.reason})</span>
          )}
        </div>
      </div>
      {isOwner && (
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
 * Inline slim variant. Pure cache reader (no polling timer of its own —
 * see useProviderStatus docstring). Drop into any data-sparse section;
 * renders nothing on loading / error / live, and inherits the banner's
 * 60s refresh cadence wherever the banner is mounted.
 */
export function KiteOfflineNote({
  area = "this section",
}: { area?: string }) {
  const { data, isLoading, isError } = useProviderStatus(null);
  if (isLoading || isError || !data) return null;
  if (data.active === "kite") return null;
  return (
    <div
      className="rounded border border-amber-500/30 bg-amber-500/5 text-amber-200 px-2 py-1.5 text-[11px] font-mono leading-snug flex items-start gap-1.5"
      data-testid="kite-offline-note"
    >
      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-400" />
      <span>
        Limited data in {area} — Zerodha Kite session is offline.
        Reconnect to restore full coverage.
      </span>
    </div>
  );
}
