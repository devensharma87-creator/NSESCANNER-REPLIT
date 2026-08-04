/**
 * ProvenanceBadge — scanner app data-provenance pill (Pack 6 Gate A / C).
 *
 * Unified badge for source/freshness state. Covers Kite (live), Yahoo (delayed),
 * IndianAPI (secondary analytics), stale, unavailable, and partial states.
 *
 * Exposes resolveProvenanceState for use in table-cell color classification
 * before rendering the badge itself.
 */

import { Badge } from "@/components/ui/badge";
import { Clock, WifiOff, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Source classification ─────────────────────────────────────────────────────

export const DELAYED_SOURCES: ReadonlySet<string> = new Set([
  "yahoo", "yahoo-fx", "yahoo-equity", "yahoo-index",
]);

export const SECONDARY_SOURCES: ReadonlySet<string> = new Set([
  "indianapi", "indian_api",
]);

export const SOURCE_LABEL: Record<string, string> = {
  kite:           "Kite",
  yahoo:          "Yahoo",
  "yahoo-fx":     "Yahoo FX",
  "yahoo-equity": "Yahoo",
  "yahoo-index":  "Yahoo",
  indianapi:      "IndianAPI",
  indian_api:     "IndianAPI",
  cached:         "Cached",
  unknown:        "Unknown",
};

// ── State types ───────────────────────────────────────────────────────────────

export type ProvenanceState =
  | "LIVE"         // real-time authoritative (Kite active session)
  | "DELAYED"      // secondary source (~15 min delayed)
  | "SECONDARY"    // non-trade-grade analytics source (IndianAPI)
  | "STALE"        // freshness window exceeded
  | "UNAVAILABLE"  // source confirmed down or not configured
  | "UNKNOWN";     // source not identifiable

export function resolveProvenanceState(opts: {
  source?: string | null;
  stale?: boolean;
  sourceHealthy?: boolean;
  isLive?: boolean;
}): ProvenanceState {
  if (opts.sourceHealthy === false) return "UNAVAILABLE";
  if (opts.stale) return "STALE";
  if (opts.source && SECONDARY_SOURCES.has(opts.source)) return "SECONDARY";
  if (opts.source && DELAYED_SOURCES.has(opts.source)) return "DELAYED";
  if (opts.source === "kite" || opts.isLive) return "LIVE";
  return "UNKNOWN";
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface ProvenanceBadgeProps {
  source?: string | null;
  stale?: boolean;
  sourceHealthy?: boolean;
  isLive?: boolean;
  ageMs?: number | null;
  /** Show a badge even for LIVE state (default: false — live is quiet). */
  showLive?: boolean;
  className?: string;
}

export function ProvenanceBadge({
  source,
  stale = false,
  sourceHealthy,
  isLive,
  ageMs,
  showLive = false,
  className = "",
}: ProvenanceBadgeProps) {
  const state = resolveProvenanceState({ source, stale, sourceHealthy, isLive });
  const sourceLabel = source ? (SOURCE_LABEL[source] ?? source) : "";

  switch (state) {
    case "LIVE":
      if (!showLive) return null;
      return (
        <Badge
          variant="outline"
          data-testid="badge-live"
          data-state="LIVE"
          className={cn(
            "h-4 px-1 text-[10px] gap-0.5",
            "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
            className,
          )}
        >
          <CheckCircle2 className="h-2.5 w-2.5" aria-hidden />
          live
        </Badge>
      );

    case "DELAYED":
      return (
        <Badge
          variant="outline"
          data-testid="badge-delayed"
          data-state="DELAYED"
          title={`${sourceLabel} Finance data — approximately 15 minutes delayed. Informational only; not trade-grade.`}
          className={cn(
            "h-4 px-1 text-[10px] gap-0.5",
            "text-sky-400 border-sky-500/40 bg-sky-500/10",
            className,
          )}
        >
          <Clock className="h-2.5 w-2.5" aria-hidden />
          delayed
        </Badge>
      );

    case "SECONDARY":
      return (
        <Badge
          variant="outline"
          data-testid="badge-secondary"
          data-state="SECONDARY"
          title={`${sourceLabel} — reference/analytics data. Not trade-grade. Never replaces Kite live price.`}
          className={cn(
            "h-4 px-1 text-[10px] gap-0.5",
            "text-purple-400 border-purple-500/40 bg-purple-500/10",
            className,
          )}
        >
          ref
        </Badge>
      );

    case "STALE":
      return (
        <Badge
          variant="outline"
          data-testid="badge-stale"
          data-state="STALE"
          title={`Data stale — last update: ${ageMs != null ? `${Math.round(ageMs / 1000)}s ago` : "unknown"}.`}
          className={cn(
            "h-4 px-1 text-[10px] gap-0.5",
            "text-amber-300 border-amber-500/40 bg-amber-500/10",
            className,
          )}
        >
          <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
          stale
        </Badge>
      );

    case "UNAVAILABLE":
      return (
        <Badge
          variant="outline"
          data-testid="badge-unavailable"
          data-state="UNAVAILABLE"
          title={`Data source unavailable — value is last-known or absent.${ageMs != null ? ` Last update: ${Math.round(ageMs / 1000)}s ago.` : ""}`}
          className={cn(
            "h-4 px-1 text-[10px] gap-0.5",
            "text-destructive border-destructive/50",
            className,
          )}
        >
          <WifiOff className="h-2.5 w-2.5" aria-hidden />
          unavailable
        </Badge>
      );

    default:
      return null;
  }
}

export default ProvenanceBadge;
