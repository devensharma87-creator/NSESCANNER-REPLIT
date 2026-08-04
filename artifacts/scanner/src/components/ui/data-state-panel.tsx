/**
 * DataStatePanel — unified semantic data-state display (Pack 6 Gate C).
 *
 * Covers all 9 canonical states:
 *   LOADING · READY_LIVE · READY_DELAYED · READY_STALE · READY_PARTIAL ·
 *   EMPTY_VALID · DEGRADED · UNAVAILABLE · ERROR · CLOSED
 *
 * Use this component instead of ad-hoc "if isLoading return <Skeleton />"
 * chains — it ensures consistent wording, icons, and retry actions across
 * every surface.
 */

import {
  Loader2,
  WifiOff,
  AlertTriangle,
  XCircle,
  Clock,
  Moon,
  RefreshCw,
  Info,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── State types ───────────────────────────────────────────────────────────────

export type DataState =
  | "LOADING"
  | "READY_LIVE"
  | "READY_DELAYED"
  | "READY_STALE"
  | "READY_PARTIAL"
  | "EMPTY_VALID"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "ERROR"
  | "CLOSED";

// ── Panel size ────────────────────────────────────────────────────────────────

export type DataStatePanelSize = "sm" | "md" | "lg";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DataStatePanelProps {
  /** Canonical state (required). */
  state: DataState;
  /** Override the default heading for this state. */
  title?: string;
  /** Override the default descriptive body text. */
  description?: string;
  /** ISO timestamp or epoch ms of the last known update (shown for STALE). */
  lastUpdated?: string | number | null;
  /** Source name shown for DELAYED / STALE / DEGRADED. */
  sourceName?: string;
  /** What is missing (shown for PARTIAL). */
  missingItems?: string[];
  /** Show a retry button with this label (calls `onRetry` when clicked). */
  retryLabel?: string;
  /** Called when the retry button is clicked. */
  onRetry?: () => void;
  /** True while a retry is in flight (shows spinner on the button). */
  retrying?: boolean;
  /** Compact single-line chip variant — hides description. */
  size?: DataStatePanelSize;
  className?: string;
  /** Extra children rendered below the description (e.g. actions). */
  children?: React.ReactNode;
}

// ── Default display map ───────────────────────────────────────────────────────

interface StateMeta {
  icon: React.ElementType;
  iconClass: string;
  defaultTitle: string;
  defaultDesc: string;
}

const STATE_META: Record<DataState, StateMeta> = {
  LOADING: {
    icon: Loader2,
    iconClass: "animate-spin text-muted-foreground",
    defaultTitle: "Loading…",
    defaultDesc: "Fetching data — this will take a moment.",
  },
  READY_LIVE: {
    icon: Info,
    iconClass: "text-positive",
    defaultTitle: "Live",
    defaultDesc: "Data is up to date.",
  },
  READY_DELAYED: {
    icon: Clock,
    iconClass: "text-stale",
    defaultTitle: "Delayed data",
    defaultDesc: "This data is from a delayed secondary source (~15 min). Not trade-grade.",
  },
  READY_STALE: {
    icon: AlertTriangle,
    iconClass: "text-warning",
    defaultTitle: "Stale data",
    defaultDesc: "The displayed value was last refreshed outside the freshness window. Use with caution.",
  },
  READY_PARTIAL: {
    icon: Minus,
    iconClass: "text-warning",
    defaultTitle: "Partial data",
    defaultDesc: "Some sections are unavailable. The items shown are valid.",
  },
  EMPTY_VALID: {
    icon: Info,
    iconClass: "text-muted-foreground",
    defaultTitle: "No results",
    defaultDesc: "No matching data found. This is not an error.",
  },
  DEGRADED: {
    icon: AlertTriangle,
    iconClass: "text-warning",
    defaultTitle: "Degraded",
    defaultDesc: "Operating on cached or fallback data. A live source is temporarily unavailable.",
  },
  UNAVAILABLE: {
    icon: WifiOff,
    iconClass: "text-muted-foreground",
    defaultTitle: "Unavailable",
    defaultDesc: "This data source is not configured or currently unreachable.",
  },
  ERROR: {
    icon: XCircle,
    iconClass: "text-negative",
    defaultTitle: "Error",
    defaultDesc: "Could not load data. Check your connection and try again.",
  },
  CLOSED: {
    icon: Moon,
    iconClass: "text-muted-foreground",
    defaultTitle: "Market closed",
    defaultDesc: "Live data is not available while the market is closed.",
  },
};

// ── Badge chip (sm variant) ───────────────────────────────────────────────────

const STATE_CHIP_STYLE: Partial<Record<DataState, string>> = {
  READY_STALE:   "border-warning/40 bg-warning/10 text-warning",
  READY_DELAYED: "border-stale/40 bg-stale/10 text-stale",
  READY_PARTIAL: "border-warning/40 bg-warning/10 text-warning",
  DEGRADED:      "border-warning/40 bg-warning/10 text-warning",
  UNAVAILABLE:   "border-border/40 bg-muted/40 text-muted-foreground",
  ERROR:         "border-negative/40 bg-negative/10 text-negative",
  CLOSED:        "border-border/40 bg-muted/40 text-muted-foreground",
  LOADING:       "border-border/40 bg-muted/40 text-muted-foreground",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(at: string | number): string {
  const ts = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ts)) return "unknown time";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DataStatePanel({
  state,
  title,
  description,
  lastUpdated,
  sourceName,
  missingItems,
  retryLabel = "Retry",
  onRetry,
  retrying = false,
  size = "md",
  className,
  children,
}: DataStatePanelProps) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  const displayTitle = title ?? meta.defaultTitle;
  const displayDesc = description ?? meta.defaultDesc;

  // sm = inline chip
  if (size === "sm") {
    const chipStyle = STATE_CHIP_STYLE[state] ?? "border-border/40 bg-muted/40 text-muted-foreground";
    return (
      <span
        role="status"
        data-state={state}
        data-testid={`data-state-panel-${state.toLowerCase()}`}
        className={cn(
          "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold leading-none",
          chipStyle,
          className,
        )}
      >
        <Icon
          className={cn("h-3 w-3", meta.iconClass)}
          aria-hidden
        />
        <span>{displayTitle}</span>
      </span>
    );
  }

  // md / lg = full panel
  const isCompact = size === "md";
  return (
    <div
      role="status"
      aria-live={state === "LOADING" ? "polite" : undefined}
      aria-label={displayTitle}
      data-state={state}
      data-testid={`data-state-panel-${state.toLowerCase()}`}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center",
        isCompact ? "py-6 min-h-[96px]" : "py-12 min-h-[160px]",
        className,
      )}
    >
      <Icon
        className={cn(isCompact ? "h-5 w-5" : "h-7 w-7", meta.iconClass)}
        aria-hidden
      />
      <div className={cn("flex flex-col gap-1", isCompact ? "gap-0.5" : "gap-1.5")}>
        <p className={cn("font-semibold", isCompact ? "text-sm" : "text-base")}>
          {displayTitle}
        </p>
        {!isCompact && (
          <p className="text-sm text-muted-foreground max-w-sm">{displayDesc}</p>
        )}
        {isCompact && description && (
          <p className="text-xs text-muted-foreground max-w-sm">{description}</p>
        )}
        {/* Stale last-updated */}
        {(state === "READY_STALE" || state === "DEGRADED") && lastUpdated != null && (
          <p className="text-xs text-muted-foreground font-mono tabular-nums">
            Last updated: {fmtAge(lastUpdated)}
            {sourceName ? ` · ${sourceName}` : ""}
          </p>
        )}
        {/* Delayed source */}
        {state === "READY_DELAYED" && sourceName && (
          <p className="text-xs text-muted-foreground">
            Source: {sourceName} (~15 min delayed)
          </p>
        )}
        {/* Partial missing items */}
        {state === "READY_PARTIAL" && missingItems && missingItems.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Missing: {missingItems.join(", ")}
          </p>
        )}
      </div>
      {onRetry && state !== "LOADING" && state !== "CLOSED" && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={retrying}
          className="mt-1"
          aria-label={retryLabel}
        >
          {retrying ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          )}
          {retryLabel}
        </Button>
      )}
      {children}
    </div>
  );
}

export default DataStatePanel;
