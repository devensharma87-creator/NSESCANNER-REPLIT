/**
 * Uniform data-source / freshness pill (audit AUD-005).
 *
 * Renders a single horizontal strip showing:
 *   • the upstream data source (Kite live / TradingView / Yahoo delayed / mixed)
 *   • a coloured status dot (live / stale / down)
 *   • the wall-clock "last updated N seconds ago"
 *   • optional refresh-cadence hint (e.g. "auto-refreshes every 30s")
 *   • optional fallback warning when the primary feed has degraded
 *
 * The component is intentionally low-density so it slots into any page
 * header without competing with the page title. Every data page should
 * surface one of these so users have a single, predictable place to
 * confirm whether what they are looking at is real-time, delayed or
 * stale before they act on it.
 */

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CircleSlash, Wifi } from "lucide-react";

export type DataSource = "kite" | "tv" | "yahoo" | "mixed" | "cache" | "unknown";
export type FeedStatus = "live" | "delayed" | "stale" | "down";

export interface DataSourceBadgeProps {
  /** Upstream that produced the rendered data. */
  source: DataSource;
  /** Coarse health state — drives the dot colour and pill tone. */
  status?: FeedStatus;
  /** ISO string or epoch ms of the most recent successful refresh. */
  lastUpdated?: string | number | null;
  /** Polling cadence in ms — surfaces "auto-refreshes every Ns". */
  refreshMs?: number;
  /** Set when the primary feed degraded to its fallback (e.g. Yahoo). */
  fallbackActive?: boolean;
  /** Free-form note shown after the cadence (e.g. "EOD bhavcopy"). */
  note?: string;
  /** Visually shrink the pill for use inside dense headers. */
  compact?: boolean;
  className?: string;
}

const SOURCE_LABEL: Record<DataSource, string> = {
  kite:    "Kite (live)",
  tv:      "TradingView",
  yahoo:   "Yahoo (~15m delayed)",
  mixed:   "Mixed sources",
  cache:   "Cached",
  unknown: "Source unknown",
};

const STATUS_TONE: Record<FeedStatus, { dot: string; ring: string; text: string }> = {
  live:    { dot: "bg-emerald-500 animate-pulse", ring: "border-emerald-500/40 bg-emerald-500/10", text: "text-emerald-500" },
  delayed: { dot: "bg-amber-500",                 ring: "border-amber-500/40 bg-amber-500/10",     text: "text-amber-500"   },
  stale:   { dot: "bg-orange-500",                ring: "border-orange-500/40 bg-orange-500/10",   text: "text-orange-500"  },
  down:    { dot: "bg-rose-500",                  ring: "border-rose-500/40 bg-rose-500/10",       text: "text-rose-500"    },
};

function relTime(at: number, now: number): string {
  const diff = Math.max(0, Math.round((now - at) / 1000));
  if (diff < 5)   return "just now";
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s ago`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m ago`;
}

/**
 * Small ticking clock that re-renders the relative time every second.
 * Lifted into its own component so the parent badge does not have to
 * subscribe to a 1-Hz interval when no `lastUpdated` is provided.
 */
function LastUpdatedTicker({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="font-mono tabular-nums">{relTime(at, now)}</span>;
}

export function DataSourceBadge({
  source,
  status = "live",
  lastUpdated,
  refreshMs,
  fallbackActive = false,
  note,
  compact = false,
  className,
}: DataSourceBadgeProps) {
  // If the caller explicitly flagged a fallback and didn't downgrade
  // the status itself, push status to "delayed" so the pill colour
  // matches the message — otherwise users see a green dot next to
  // "Yahoo fallback" which is the exact mismatch the audit flagged.
  const effectiveStatus: FeedStatus =
    fallbackActive && status === "live" ? "delayed" : status;
  const tone = STATUS_TONE[effectiveStatus];

  const lastTs =
    lastUpdated == null ? null
    : typeof lastUpdated === "number" ? lastUpdated
    : Date.parse(lastUpdated);
  const tsValid = lastTs != null && Number.isFinite(lastTs);

  const StatusIcon =
    effectiveStatus === "down" ? CircleSlash :
    effectiveStatus === "live" ? Wifi :
    effectiveStatus === "stale" ? AlertTriangle :
    Activity;

  return (
    <div
      data-testid="data-source-badge"
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 ${compact ? "py-0.5 text-[10px]" : "py-1 text-[11px]"} font-mono ${tone.ring} ${className ?? ""}`}
    >
      <span className="relative inline-flex items-center">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
        <StatusIcon className={`ml-1.5 h-3 w-3 ${tone.text}`} aria-hidden />
      </span>
      <span className={`${tone.text} font-semibold`}>{SOURCE_LABEL[source]}</span>
      {fallbackActive && (
        <span className="text-amber-500/90 uppercase tracking-wider text-[9px] font-bold">FALLBACK</span>
      )}
      {tsValid && (
        <span className="text-muted-foreground">
          updated <LastUpdatedTicker at={lastTs!} />
        </span>
      )}
      {refreshMs && refreshMs > 0 && (
        <span className="text-muted-foreground/70 hidden sm:inline">
          · refresh {Math.round(refreshMs / 1000)}s
        </span>
      )}
      {note && (
        <span className="text-muted-foreground/80 italic hidden md:inline">· {note}</span>
      )}
    </div>
  );
}

export default DataSourceBadge;
