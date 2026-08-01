/**
 * B2.1 — Shared data-provenance display component for Global app surfaces.
 *
 * Single authoritative source of truth for source/state labelling across
 * Dashboard, Watchlist and any future B2.1 surface that renders
 * GlobalDashboardRow data.
 *
 * Rules (from B2.1 spec):
 *   - LIVE sources (real-time, not delayed) show no badge — live is the default.
 *   - DELAYED sources (Yahoo, Yahoo-FX, Yahoo-Equity, Yahoo-Index) always show
 *     a visible "delayed" label — they must never appear as real-time.
 *   - STALE data (per API stale flag or unhealthy source) shows a stale badge.
 *   - UNAVAILABLE (sourceHealthy=false) shows an unavailable badge.
 *   - Never expose credentials, raw URLs or provider account IDs.
 *   - UNKNOWN source → no badge (not enough info to classify; keep UI clean).
 *
 * resolveDataDisplayState is exported as a pure function so it can be used
 * for color/direction classification before rendering (e.g. dashboard table
 * cells where we need the state without mounting a component).
 */

import { Badge } from "@/components/ui/badge";
import { Clock, WifiOff, AlertTriangle } from "lucide-react";

// ── Source sets ───────────────────────────────────────────────────────────────

/** Sources that are always delayed/informational — never real-time. */
export const DELAYED_SOURCES: ReadonlySet<string> = new Set([
  "yahoo",
  "yahoo-fx",
  "yahoo-equity",
  "yahoo-index",
]);

/** Human-readable labels for source codes. */
const SOURCE_DISPLAY: Record<string, string> = {
  yahoo:          "Yahoo",
  "yahoo-fx":     "Yahoo FX",
  "yahoo-equity": "Yahoo",
  "yahoo-index":  "Yahoo",
  binance:        "Binance",
};

// ── State resolution ──────────────────────────────────────────────────────────

export type DataDisplayState =
  | "LIVE"        // real-time, approved, fresh
  | "DELAYED"     // secondary/informational source (always delayed)
  | "STALE"       // approved source, last-known value older than freshness budget
  | "UNAVAILABLE" // source health failure; value absent or irrecoverable
  | "UNKNOWN";    // source not identifiable (display nothing)

/**
 * Resolve the B2.1 display state from row metadata.
 *
 * Pure function — safe to call outside React (e.g. for table-cell
 * color/direction classification before rendering the badge itself).
 *
 * Priority order (most critical wins):
 *   UNAVAILABLE → STALE → DELAYED → LIVE → UNKNOWN
 */
export function resolveDataDisplayState(opts: {
  source?: string;
  stale: boolean;
  sourceHealthy?: boolean;
}): DataDisplayState {
  if (opts.sourceHealthy === false) return "UNAVAILABLE";
  if (opts.stale) return "STALE";
  if (opts.source && DELAYED_SOURCES.has(opts.source)) return "DELAYED";
  if (opts.source === "binance") return "LIVE";
  return "UNKNOWN";
}

// ── Component ─────────────────────────────────────────────────────────────────

interface DataProvenanceBadgeProps {
  /** Provider/source code from the API response. */
  source?: string;
  /** True when the row's data is older than the freshness budget. */
  stale?: boolean;
  /** False when the upstream source is confirmed unhealthy. */
  sourceHealthy?: boolean;
  /** Milliseconds since the row's last successful update. Used in tooltip. */
  ageMs?: number | null;
  className?: string;
}

/**
 * Compact provenance badge for B2.1 data rows.
 *
 * Shows nothing for LIVE (the default healthy state); shows "delayed",
 * "stale" or "unavailable" badges for non-live states.
 *
 * The companion stale badge rendered by individual table rows handles
 * the STALE visual — this component skips STALE to avoid duplication.
 * Pass `showStale={true}` if you need the stale badge here too.
 */
export function DataProvenanceBadge({
  source,
  stale = false,
  sourceHealthy,
  ageMs,
  className = "",
}: DataProvenanceBadgeProps) {
  const state = resolveDataDisplayState({ source, stale, sourceHealthy });

  if (state === "DELAYED") {
    const label = source ? (SOURCE_DISPLAY[source] ?? source) : "Yahoo";
    return (
      <Badge
        variant="outline"
        className={`h-4 px-1 text-[10px] gap-0.5 text-sky-600 border-sky-400 dark:text-sky-400 dark:border-sky-700 ${className}`}
        title={`${label} Finance data — approximately 15 minutes delayed. Informational only; not trade-grade.`}
        data-testid="badge-delayed"
        data-state="DELAYED"
      >
        <Clock className="h-2.5 w-2.5" />
        delayed
      </Badge>
    );
  }

  if (state === "UNAVAILABLE") {
    return (
      <Badge
        variant="outline"
        className={`h-4 px-1 text-[10px] gap-0.5 text-destructive border-destructive/50 ${className}`}
        title={`Data source unavailable — value is last-known or absent.${ageMs != null ? ` Last update: ${Math.round(ageMs / 1000)}s ago.` : ""}`}
        data-testid="badge-unavailable"
        data-state="UNAVAILABLE"
      >
        <WifiOff className="h-2.5 w-2.5" />
        unavailable
      </Badge>
    );
  }

  // STALE is rendered by the existing per-row stale badge — skip here.
  // LIVE → no badge (healthy default). UNKNOWN → no badge (insufficient info).
  return null;
}

/**
 * Standalone stale badge for surfaces that need it without the full
 * DataProvenanceBadge (e.g. StatusStrip source entries).
 */
export function StaleBadge({
  ageMs,
  title,
  className = "",
}: {
  ageMs?: number | null;
  title?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={`h-4 px-1 text-[10px] gap-0.5 text-amber-700 border-amber-400 dark:text-amber-300 dark:border-amber-700 ${className}`}
      title={title ?? `Data stale — last update: ${ageMs != null ? `${Math.round(ageMs / 1000)}s ago` : "unknown"}.`}
      data-testid="badge-stale"
      data-state="STALE"
    >
      <AlertTriangle className="h-2.5 w-2.5" />
      stale
    </Badge>
  );
}
