/**
 * DataStatePanel — unified semantic data-state display (Pack 6 Gate C).
 * Global app variant — mirrors artifacts/scanner/src/components/ui/data-state-panel.tsx.
 */

import {
  Loader2, WifiOff, AlertTriangle, XCircle,
  Clock, Moon, RefreshCw, Info, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type DataState =
  | "LOADING" | "READY_LIVE" | "READY_DELAYED" | "READY_STALE" | "READY_PARTIAL"
  | "EMPTY_VALID" | "DEGRADED" | "UNAVAILABLE" | "ERROR" | "CLOSED";

export type DataStatePanelSize = "sm" | "md" | "lg";

export interface DataStatePanelProps {
  state: DataState;
  title?: string;
  description?: string;
  lastUpdated?: string | number | null;
  sourceName?: string;
  missingItems?: string[];
  retryLabel?: string;
  onRetry?: () => void;
  retrying?: boolean;
  size?: DataStatePanelSize;
  className?: string;
  children?: React.ReactNode;
}

interface StateMeta {
  icon: React.ElementType;
  iconClass: string;
  defaultTitle: string;
  defaultDesc: string;
}

const STATE_META: Record<DataState, StateMeta> = {
  LOADING:       { icon: Loader2,       iconClass: "animate-spin text-muted-foreground", defaultTitle: "Loading…",         defaultDesc: "Fetching data — this will take a moment." },
  READY_LIVE:    { icon: Info,           iconClass: "text-green-500 dark:text-green-400", defaultTitle: "Live",             defaultDesc: "Data is up to date." },
  READY_DELAYED: { icon: Clock,          iconClass: "text-amber-500 dark:text-amber-400", defaultTitle: "Delayed data",     defaultDesc: "Data is from a delayed secondary source (~15 min). Not trade-grade." },
  READY_STALE:   { icon: AlertTriangle,  iconClass: "text-amber-500 dark:text-amber-400", defaultTitle: "Stale data",       defaultDesc: "Data is outside the freshness window. Use with caution." },
  READY_PARTIAL: { icon: Minus,          iconClass: "text-amber-500 dark:text-amber-400", defaultTitle: "Partial data",     defaultDesc: "Some sections are unavailable. Items shown are valid." },
  EMPTY_VALID:   { icon: Info,           iconClass: "text-muted-foreground",               defaultTitle: "No results",       defaultDesc: "No matching data found. This is not an error." },
  DEGRADED:      { icon: AlertTriangle,  iconClass: "text-amber-500 dark:text-amber-400", defaultTitle: "Degraded",         defaultDesc: "Operating on cached or fallback data." },
  UNAVAILABLE:   { icon: WifiOff,        iconClass: "text-muted-foreground",               defaultTitle: "Unavailable",      defaultDesc: "This data source is not configured or unreachable." },
  ERROR:         { icon: XCircle,        iconClass: "text-destructive",                    defaultTitle: "Error",            defaultDesc: "Could not load data. Check your connection and try again." },
  CLOSED:        { icon: Moon,           iconClass: "text-muted-foreground",               defaultTitle: "Market closed",    defaultDesc: "Live data is not available while the market is closed." },
};

function fmtAge(at: string | number): string {
  const ts = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ts)) return "unknown time";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export function DataStatePanel({
  state, title, description, lastUpdated, sourceName, missingItems,
  retryLabel = "Retry", onRetry, retrying = false, size = "md", className, children,
}: DataStatePanelProps) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  const displayTitle = title ?? meta.defaultTitle;
  const displayDesc = description ?? meta.defaultDesc;
  const isCompact = size === "md";

  if (size === "sm") {
    return (
      <span
        role="status"
        data-state={state}
        data-testid={`data-state-panel-${state.toLowerCase()}`}
        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold leading-none border-border/40 bg-muted/40 text-muted-foreground ${className ?? ""}`}
      >
        <Icon className={`h-3 w-3 ${meta.iconClass}`} aria-hidden />
        <span>{displayTitle}</span>
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live={state === "LOADING" ? "polite" : undefined}
      aria-label={displayTitle}
      data-state={state}
      data-testid={`data-state-panel-${state.toLowerCase()}`}
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center ${isCompact ? "py-6 min-h-[96px]" : "py-12 min-h-[160px]"} ${className ?? ""}`}
    >
      <Icon className={`${isCompact ? "h-5 w-5" : "h-7 w-7"} ${meta.iconClass}`} aria-hidden />
      <div className={`flex flex-col ${isCompact ? "gap-0.5" : "gap-1.5"}`}>
        <p className={`font-semibold ${isCompact ? "text-sm" : "text-base"}`}>{displayTitle}</p>
        {(!isCompact || description) && (
          <p className="text-sm text-muted-foreground max-w-sm">{description ?? displayDesc}</p>
        )}
        {(state === "READY_STALE" || state === "DEGRADED") && lastUpdated != null && (
          <p className="text-xs text-muted-foreground font-mono tabular-nums">
            Last updated: {fmtAge(lastUpdated)}{sourceName ? ` · ${sourceName}` : ""}
          </p>
        )}
        {state === "READY_DELAYED" && sourceName && (
          <p className="text-xs text-muted-foreground">Source: {sourceName} (~15 min delayed)</p>
        )}
        {state === "READY_PARTIAL" && missingItems && missingItems.length > 0 && (
          <p className="text-xs text-muted-foreground">Missing: {missingItems.join(", ")}</p>
        )}
      </div>
      {onRetry && state !== "LOADING" && state !== "CLOSED" && (
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} className="mt-1" aria-label={retryLabel}>
          {retrying
            ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden />
            : <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />}
          {retryLabel}
        </Button>
      )}
      {children}
    </div>
  );
}

export default DataStatePanel;
